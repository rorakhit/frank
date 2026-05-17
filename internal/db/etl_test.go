package db

import (
	"context"
	"testing"
	"time"

	"github.com/rorakhit/frank/internal/testdb"
)

func makeMeta(ok bool, errStr string) ScraperMeta {
	return ScraperMeta{
		RanAt: time.Date(2026, 5, 17, 2, 0, 0, 0, time.UTC),
		Ok:    ok,
		Error: errStr,
	}
}

func makeETLTxn(srcAcctID, srcTxID, direction string, amount float64, pending bool) ETLTransaction {
	return ETLTransaction{
		SourceAccountID: srcAcctID,
		AccountName:     "Test Account",
		AccountType:     "checking",
		AccountLast4:    "1234",
		Date:            time.Date(2026, 5, 10, 0, 0, 0, 0, time.UTC),
		Amount:          amount,
		Direction:       direction,
		Description:     "Test Merchant",
		RawType:         "purchase",
		IsPending:       pending,
		Raw:             []byte(`{}`),
		SourceTxID:      srcTxID,
	}
}

func TestUpsertTransactions_FreshInsert(t *testing.T) {
	pool := testdb.New(t)
	ctx := context.Background()

	txns := []ETLTransaction{
		makeETLTxn("acct-001", "tx-001", "debit", 42.50, false),
		makeETLTxn("acct-001", "tx-002", "credit", 1500.00, false),
	}

	result, err := UpsertTransactions(ctx, pool, "affinity_fcu", txns, makeMeta(true, ""))
	if err != nil {
		t.Fatalf("UpsertTransactions: %v", err)
	}
	if result.AccountsUpserted != 1 {
		t.Errorf("AccountsUpserted = %d, want 1", result.AccountsUpserted)
	}
	if result.TransactionsInserted != 2 {
		t.Errorf("TransactionsInserted = %d, want 2", result.TransactionsInserted)
	}
	if result.TransactionsUpdated != 0 {
		t.Errorf("TransactionsUpdated = %d, want 0", result.TransactionsUpdated)
	}

	var count int
	pool.QueryRow(ctx, `SELECT count(*) FROM transactions`).Scan(&count)
	if count != 2 {
		t.Errorf("expected 2 rows in transactions, got %d", count)
	}
}

func TestUpsertTransactions_Idempotent(t *testing.T) {
	pool := testdb.New(t)
	ctx := context.Background()

	txns := []ETLTransaction{
		makeETLTxn("acct-002", "tx-idem-001", "debit", 10.00, false),
	}

	// First run — insert.
	if _, err := UpsertTransactions(ctx, pool, "sofi", txns, makeMeta(true, "")); err != nil {
		t.Fatalf("first UpsertTransactions: %v", err)
	}

	// Second run — same data, should update, not duplicate.
	result, err := UpsertTransactions(ctx, pool, "sofi", txns, makeMeta(true, ""))
	if err != nil {
		t.Fatalf("second UpsertTransactions: %v", err)
	}
	if result.TransactionsInserted != 0 {
		t.Errorf("second run TransactionsInserted = %d, want 0", result.TransactionsInserted)
	}
	if result.TransactionsUpdated != 1 {
		t.Errorf("second run TransactionsUpdated = %d, want 1", result.TransactionsUpdated)
	}

	var count int
	pool.QueryRow(ctx, `SELECT count(*) FROM transactions`).Scan(&count)
	if count != 1 {
		t.Errorf("expected 1 row after two identical runs, got %d", count)
	}
}

func TestUpsertTransactions_PendingFlip(t *testing.T) {
	pool := testdb.New(t)
	ctx := context.Background()

	txns := []ETLTransaction{makeETLTxn("acct-003", "tx-pend-001", "debit", 25.00, true)}

	if _, err := UpsertTransactions(ctx, pool, "chase", txns, makeMeta(true, "")); err != nil {
		t.Fatalf("insert pending: %v", err)
	}

	// Re-run with is_pending = false.
	txns[0].IsPending = false
	if _, err := UpsertTransactions(ctx, pool, "chase", txns, makeMeta(true, "")); err != nil {
		t.Fatalf("update pending: %v", err)
	}

	var isPending bool
	pool.QueryRow(ctx, `SELECT is_pending FROM transactions WHERE source_tx_id = 'tx-pend-001'`).Scan(&isPending)
	if isPending {
		t.Error("expected is_pending = false after update, got true")
	}
}

func TestUpsertTransactions_InstitutionStatusUpdated(t *testing.T) {
	pool := testdb.New(t)
	ctx := context.Background()

	errMsg := "session expired"
	meta := ScraperMeta{
		RanAt: time.Date(2026, 5, 17, 2, 0, 0, 0, time.UTC),
		Ok:    false,
		Error: errMsg,
	}

	if _, err := UpsertTransactions(ctx, pool, "sofi", nil, meta); err != nil {
		t.Fatalf("UpsertTransactions: %v", err)
	}

	var ok bool
	var scraperErr string
	pool.QueryRow(ctx, `SELECT last_scrape_ok, COALESCE(last_scrape_error, '') FROM institutions WHERE source = 'sofi'`).Scan(&ok, &scraperErr)

	if ok {
		t.Error("expected last_scrape_ok = false")
	}
	if scraperErr != errMsg {
		t.Errorf("last_scrape_error = %q, want %q", scraperErr, errMsg)
	}
}

func TestUpsertTransactions_AccountDedup(t *testing.T) {
	pool := testdb.New(t)
	ctx := context.Background()

	// Two transactions for the same source account ID.
	txns := []ETLTransaction{
		makeETLTxn("acct-dedup", "tx-d-001", "debit", 5.00, false),
		makeETLTxn("acct-dedup", "tx-d-002", "debit", 15.00, false),
	}

	if _, err := UpsertTransactions(ctx, pool, "affinity_fcu", txns, makeMeta(true, "")); err != nil {
		t.Fatalf("first run: %v", err)
	}
	if _, err := UpsertTransactions(ctx, pool, "affinity_fcu", txns, makeMeta(true, "")); err != nil {
		t.Fatalf("second run: %v", err)
	}

	var count int
	pool.QueryRow(ctx, `SELECT count(*) FROM accounts WHERE source_account_id = 'acct-dedup'`).Scan(&count)
	if count != 1 {
		t.Errorf("expected 1 account row after two runs, got %d", count)
	}
}
