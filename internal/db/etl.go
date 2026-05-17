package db

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type ScraperMeta struct {
	RanAt time.Time
	Ok    bool
	Error string
}

type ETLTransaction struct {
	SourceAccountID string
	AccountName     string
	AccountType     string
	AccountLast4    string
	Date            time.Time
	Amount          float64
	Direction       string // "debit" | "credit"
	Description     string
	RawType         string
	IsPending       bool
	Raw             []byte // jsonb
	SourceTxID      string
}

type ETLResult struct {
	AccountsUpserted     int
	TransactionsInserted int
	TransactionsUpdated  int
}

func UpsertTransactions(ctx context.Context, pool *pgxpool.Pool, source string, txns []ETLTransaction, meta ScraperMeta) (ETLResult, error) {
	var result ETLResult

	// Fetch institution ID — seed data must exist.
	var instID string
	err := pool.QueryRow(ctx, `SELECT id FROM institutions WHERE source = $1`, source).Scan(&instID)
	if err != nil {
		return result, fmt.Errorf("institution %q not found: %w", source, err)
	}

	// Update institution scrape status.
	var errText *string
	if meta.Error != "" {
		errText = &meta.Error
	}
	_, err = pool.Exec(ctx, `
		UPDATE institutions
		SET last_scraped_at = $1, last_scrape_ok = $2, last_scrape_error = $3
		WHERE source = $4
	`, meta.RanAt, meta.Ok, errText, source)
	if err != nil {
		return result, fmt.Errorf("update institution status: %w", err)
	}

	// Group transactions by source account ID.
	byAccount := make(map[string][]ETLTransaction)
	accountMeta := make(map[string]ETLTransaction) // one row per account for name/type/mask
	for _, txn := range txns {
		byAccount[txn.SourceAccountID] = append(byAccount[txn.SourceAccountID], txn)
		accountMeta[txn.SourceAccountID] = txn
	}

	for srcAcctID, acctTxns := range byAccount {
		meta := accountMeta[srcAcctID]

		// Upsert account, get Postgres UUID.
		var acctID string
		err := pool.QueryRow(ctx, `
			INSERT INTO accounts (institution_id, source_account_id, name, type, mask)
			VALUES ($1, $2, $3, $4, $5)
			ON CONFLICT (institution_id, source_account_id)
			DO UPDATE SET name = EXCLUDED.name, type = EXCLUDED.type, mask = EXCLUDED.mask
			RETURNING id
		`, instID, srcAcctID, meta.AccountName, meta.AccountType, meta.AccountLast4).Scan(&acctID)
		if err != nil {
			return result, fmt.Errorf("upsert account %q: %w", srcAcctID, err)
		}
		result.AccountsUpserted++

		// Batch-upsert all transactions for this account.
		// Use xmax to distinguish true inserts from conflict-updates:
		// xmax = 0 means the row is newly inserted; xmax != 0 means it was updated.
		batch := &pgx.Batch{}
		for _, txn := range acctTxns {
			batch.Queue(`
				INSERT INTO transactions
				  (account_id, source_tx_id, date, amount, direction, description, raw_type, is_pending, raw)
				VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
				ON CONFLICT (account_id, source_tx_id) DO UPDATE SET
				  date        = EXCLUDED.date,
				  amount      = EXCLUDED.amount,
				  direction   = EXCLUDED.direction,
				  description = EXCLUDED.description,
				  raw_type    = EXCLUDED.raw_type,
				  is_pending  = EXCLUDED.is_pending,
				  raw         = EXCLUDED.raw
				RETURNING (xmax = 0) AS inserted
			`,
				acctID, txn.SourceTxID, txn.Date, txn.Amount, txn.Direction,
				txn.Description, txn.RawType, txn.IsPending, txn.Raw,
			)
		}

		br := pool.SendBatch(ctx, batch)
		for range acctTxns {
			var inserted bool
			if err := br.QueryRow().Scan(&inserted); err != nil {
				br.Close()
				return result, fmt.Errorf("upsert transaction: %w", err)
			}
			if inserted {
				result.TransactionsInserted++
			} else {
				result.TransactionsUpdated++
			}
		}
		if err := br.Close(); err != nil {
			return result, fmt.Errorf("batch close: %w", err)
		}
	}

	return result, nil
}

// ScraperAccountBalance is a balance snapshot written by a scraper into the meta sidecar.
type ScraperAccountBalance struct {
	SourceAccountID  string
	Name             string
	Last4            string
	CurrentBalance   float64
	AvailableBalance float64 // 0 if not provided
	CreditLimit      float64 // 0 if not provided
}

// InsertBalanceSnapshots records a balance snapshot for each scraped account and,
// for credit card accounts (CreditLimit > 0), updates credit_accounts.current_balance.
// Accounts not yet in the DB are silently skipped.
func InsertBalanceSnapshots(ctx context.Context, pool *pgxpool.Pool, balances []ScraperAccountBalance) error {
	for _, b := range balances {
		// Resolve accounts.id from the scraper's source_account_id.
		var acctID string
		err := pool.QueryRow(ctx,
			`SELECT id FROM accounts WHERE source_account_id = $1`,
			b.SourceAccountID,
		).Scan(&acctID)
		if err != nil {
			continue // account not yet in DB — ETL must run first
		}

		// Record a balance snapshot.
		_, err = pool.Exec(ctx,
			`INSERT INTO balance_snapshots (account_id, balance) VALUES ($1, $2)`,
			acctID, b.CurrentBalance,
		)
		if err != nil {
			return fmt.Errorf("insert balance snapshot for %q: %w", b.SourceAccountID, err)
		}

		// For credit card accounts, keep credit_accounts.current_balance current.
		if b.CreditLimit > 0 {
			_, _ = pool.Exec(ctx, `
				UPDATE credit_accounts
				SET current_balance = $1, updated_at = now()
				WHERE active = true
				  AND (name ILIKE $2 OR notes ILIKE $3)
			`, b.CurrentBalance, "%"+b.Name+"%", "%"+b.Last4+"%")
		}
	}
	return nil
}
