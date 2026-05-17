package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"runtime"
	"time"

	"github.com/rorakhit/frank/internal/db"
)

// rawTxn mirrors the JSON output format produced by each Python scraper.
type rawTxn struct {
	Source       string          `json:"source"`
	SourceTxID   string          `json:"source_tx_id"`
	AccountID    string          `json:"account_id"`
	AccountName  string          `json:"account_name"`
	AccountType  string          `json:"account_type"`
	AccountLast4 string          `json:"account_last4"`
	Date         string          `json:"date"` // "YYYY-MM-DD"
	Amount       float64         `json:"amount"`
	Direction    string          `json:"direction"` // "debit" | "credit"
	Description  string          `json:"description"`
	RawType      string          `json:"raw_type"`
	Pending      bool            `json:"pending"`
	Raw          json.RawMessage `json:"raw"`
}

// rawAccountBalance mirrors one entry in the account_balances list from browser.write_meta().
type rawAccountBalance struct {
	SourceAccountID  string  `json:"source_account_id"`
	Name             string  `json:"name"`
	Last4            string  `json:"last4"`
	CurrentBalance   float64 `json:"current_balance"`
	AvailableBalance float64 `json:"available_balance"`
	CreditLimit      float64 `json:"credit_limit"`
}

// rawMeta mirrors the JSON sidecar written by browser.write_meta().
type rawMeta struct {
	Source           string              `json:"source"`
	RanAt            string              `json:"ran_at"` // RFC3339
	DaysRequested    int                 `json:"days_requested"`
	TransactionCount int                 `json:"transaction_count"`
	Ok               bool                `json:"ok"`
	Error            *string             `json:"error"`
	AccountBalances  []rawAccountBalance `json:"account_balances"`
}

func main() {
	source := flag.String("source", "", "Scraper source: affinity_fcu | sofi | chase (required)")
	dryRun := flag.Bool("dry-run", false, "Print what would be loaded without writing to DB")
	flag.Parse()

	validSources := map[string]bool{"affinity_fcu": true, "sofi": true, "chase": true}
	if !validSources[*source] {
		log.Fatalf("--source must be one of: affinity_fcu, sofi, chase (got %q)", *source)
	}

	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		log.Fatal("DATABASE_URL not set")
	}

	dataDir := dataDirectory()
	txnsFile := filepath.Join(dataDir, *source+"_transactions.json")
	metaFile := filepath.Join(dataDir, *source+"_meta.json")

	// Load transactions JSON.
	txnsData, err := os.ReadFile(txnsFile)
	if err != nil {
		log.Fatalf("read %s: %v", txnsFile, err)
	}
	var rawTxns []rawTxn
	if err := json.Unmarshal(txnsData, &rawTxns); err != nil {
		log.Fatalf("parse %s: %v", txnsFile, err)
	}

	// Load meta JSON.
	metaData, err := os.ReadFile(metaFile)
	if err != nil {
		log.Fatalf("read %s: %v", metaFile, err)
	}
	var rm rawMeta
	if err := json.Unmarshal(metaData, &rm); err != nil {
		log.Fatalf("parse %s: %v", metaFile, err)
	}

	ranAt, err := time.Parse(time.RFC3339, rm.RanAt)
	if err != nil {
		ranAt = time.Now().UTC()
	}
	meta := db.ScraperMeta{
		RanAt: ranAt,
		Ok:    rm.Ok,
	}
	if rm.Error != nil {
		meta.Error = *rm.Error
	}

	// Convert rawTxns to db.ETLTransaction.
	etlTxns := make([]db.ETLTransaction, 0, len(rawTxns))
	for _, r := range rawTxns {
		date, err := time.Parse("2006-01-02", r.Date)
		if err != nil {
			log.Printf("warning: skipping tx %q with unparseable date %q: %v", r.SourceTxID, r.Date, err)
			continue
		}
		etlTxns = append(etlTxns, db.ETLTransaction{
			SourceAccountID: r.AccountID,
			AccountName:     r.AccountName,
			AccountType:     r.AccountType,
			AccountLast4:    r.AccountLast4,
			Date:            date,
			Amount:          r.Amount,
			Direction:       r.Direction,
			Description:     r.Description,
			RawType:         r.RawType,
			IsPending:       r.Pending,
			Raw:             []byte(r.Raw),
			SourceTxID:      r.SourceTxID,
		})
	}

	fmt.Printf("[%s] Loaded %d transactions from %s\n", *source, len(etlTxns), txnsFile)

	if *dryRun {
		fmt.Printf("[%s] Dry run — skipping DB write.\n", *source)
		return
	}

	ctx := context.Background()
	pool, err := db.Connect(ctx, dsn)
	if err != nil {
		log.Fatalf("db: %v", err)
	}
	defer pool.Close()

	result, err := db.UpsertTransactions(ctx, pool, *source, etlTxns, meta)
	if err != nil {
		log.Fatalf("upsert: %v", err)
	}

	fmt.Printf("[%s] Done — accounts: %d, inserted: %d, updated: %d\n",
		*source, result.AccountsUpserted, result.TransactionsInserted, result.TransactionsUpdated)

	if len(rm.AccountBalances) > 0 {
		balances := make([]db.ScraperAccountBalance, 0, len(rm.AccountBalances))
		for _, b := range rm.AccountBalances {
			balances = append(balances, db.ScraperAccountBalance{
				SourceAccountID:  b.SourceAccountID,
				Name:             b.Name,
				Last4:            b.Last4,
				CurrentBalance:   b.CurrentBalance,
				AvailableBalance: b.AvailableBalance,
				CreditLimit:      b.CreditLimit,
			})
		}
		if err := db.InsertBalanceSnapshots(ctx, pool, balances); err != nil {
			log.Fatalf("insert balance snapshots: %v", err)
		}
		fmt.Printf("[%s] Balance snapshots inserted: %d\n", *source, len(balances))
	}
}

func dataDirectory() string {
	_, filename, _, ok := runtime.Caller(0)
	if !ok {
		return "data"
	}
	// filename is .../cmd/etl/main.go — go up 3 levels to project root
	root := filepath.Join(filepath.Dir(filename), "..", "..")
	return filepath.Join(root, "data")
}
