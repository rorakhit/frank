package db

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/rorakhit/frank/internal/testdb"
)

func TestFetchTransactions_Empty(t *testing.T) {
	pool := testdb.New(t)
	ctx := context.Background()

	start := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	end := time.Date(2026, 1, 31, 0, 0, 0, 0, time.UTC)

	txns, err := FetchTransactions(ctx, pool, start, end)
	if err != nil {
		t.Fatalf("FetchTransactions: %v", err)
	}
	if len(txns) != 0 {
		t.Errorf("expected 0 transactions on empty DB, got %d", len(txns))
	}
}

func TestFetchTransactions_ReturnsInsertedTransactions(t *testing.T) {
	pool := testdb.New(t)
	ctx := context.Background()

	// Seed institution + account
	var instID string
	err := pool.QueryRow(ctx, `
		SELECT id FROM institutions WHERE source = 'affinity_fcu'
	`).Scan(&instID)
	if err != nil {
		t.Fatalf("get institution: %v", err)
	}

	var acctID string
	err = pool.QueryRow(ctx, `
		INSERT INTO accounts (institution_id, source_account_id, name, type)
		VALUES ($1, 'test-acct-001', 'Test Checking', 'checking')
		RETURNING id
	`, instID).Scan(&acctID)
	if err != nil {
		t.Fatalf("insert account: %v", err)
	}

	// Insert two posted transactions and one pending (should be excluded)
	txDate := time.Date(2026, 5, 10, 0, 0, 0, 0, time.UTC)
	_, err = pool.Exec(ctx, `
		INSERT INTO transactions (account_id, source_tx_id, date, amount, direction, description, is_pending)
		VALUES
		  ($1, 'tx-001', $2, 42.50, 'debit',  'Coffee Shop',   false),
		  ($1, 'tx-002', $2, 1500.00, 'credit', 'Paycheck',    false),
		  ($1, 'tx-003', $2, 9.99,  'debit',  'Pending Charge', true)
	`, acctID, txDate)
	if err != nil {
		t.Fatalf("insert transactions: %v", err)
	}

	start := time.Date(2026, 5, 1, 0, 0, 0, 0, time.UTC)
	end := time.Date(2026, 5, 31, 0, 0, 0, 0, time.UTC)

	txns, err := FetchTransactions(ctx, pool, start, end)
	if err != nil {
		t.Fatalf("FetchTransactions: %v", err)
	}

	if len(txns) != 2 {
		t.Fatalf("expected 2 non-pending transactions, got %d", len(txns))
	}
}

func TestFetchTransactions_ExcludesPending(t *testing.T) {
	pool := testdb.New(t)
	ctx := context.Background()

	var instID string
	pool.QueryRow(ctx, `SELECT id FROM institutions WHERE source = 'sofi'`).Scan(&instID)

	var acctID string
	pool.QueryRow(ctx, `
		INSERT INTO accounts (institution_id, source_account_id, name, type)
		VALUES ($1, 'sofi-pend-test', 'SoFi Checking', 'checking') RETURNING id
	`, instID).Scan(&acctID)

	txDate := time.Date(2026, 5, 5, 0, 0, 0, 0, time.UTC)
	pool.Exec(ctx, `
		INSERT INTO transactions (account_id, source_tx_id, date, amount, direction, is_pending)
		VALUES ($1, 'pend-1', $2, 20.00, 'debit', true)
	`, acctID, txDate)

	txns, err := FetchTransactions(ctx, pool,
		time.Date(2026, 5, 1, 0, 0, 0, 0, time.UTC),
		time.Date(2026, 5, 31, 0, 0, 0, 0, time.UTC),
	)
	if err != nil {
		t.Fatalf("FetchTransactions: %v", err)
	}
	if len(txns) != 0 {
		t.Errorf("pending transaction should be excluded, got %d results", len(txns))
	}
}

func TestFetchTransactions_DateRangeFilter(t *testing.T) {
	pool := testdb.New(t)
	ctx := context.Background()

	var instID string
	pool.QueryRow(ctx, `SELECT id FROM institutions WHERE source = 'chase'`).Scan(&instID)

	var acctID string
	pool.QueryRow(ctx, `
		INSERT INTO accounts (institution_id, source_account_id, name, type)
		VALUES ($1, 'chase-date-test', 'Chase Card', 'credit') RETURNING id
	`, instID).Scan(&acctID)

	// Insert transactions across three months
	for i, date := range []time.Time{
		time.Date(2026, 3, 15, 0, 0, 0, 0, time.UTC), // before range
		time.Date(2026, 5, 10, 0, 0, 0, 0, time.UTC), // in range
		time.Date(2026, 5, 20, 0, 0, 0, 0, time.UTC), // in range
		time.Date(2026, 7, 1, 0, 0, 0, 0, time.UTC),  // after range
	} {
		pool.Exec(ctx, `
			INSERT INTO transactions (account_id, source_tx_id, date, amount, direction, is_pending)
			VALUES ($1, $2, $3, 10.00, 'debit', false)
		`, acctID, fmt.Sprintf("date-tx-%d", i), date)
	}

	txns, err := FetchTransactions(ctx, pool,
		time.Date(2026, 5, 1, 0, 0, 0, 0, time.UTC),
		time.Date(2026, 5, 31, 0, 0, 0, 0, time.UTC),
	)
	if err != nil {
		t.Fatalf("FetchTransactions: %v", err)
	}
	if len(txns) != 2 {
		t.Errorf("expected 2 transactions in May, got %d", len(txns))
	}
}

func TestFetchTransactions_FieldMapping(t *testing.T) {
	pool := testdb.New(t)
	ctx := context.Background()

	var instID string
	pool.QueryRow(ctx, `SELECT id FROM institutions WHERE source = 'affinity_fcu'`).Scan(&instID)

	var acctID string
	pool.QueryRow(ctx, `
		INSERT INTO accounts (institution_id, source_account_id, name, type)
		VALUES ($1, 'field-map-test', 'Field Test', 'checking') RETURNING id
	`, instID).Scan(&acctID)

	txDate := time.Date(2026, 5, 12, 0, 0, 0, 0, time.UTC)
	pool.Exec(ctx, `
		INSERT INTO transactions
		  (account_id, source_tx_id, date, amount, direction, description, description_normal,
		   category, is_income, is_recurring, is_pending)
		VALUES ($1, 'field-tx-1', $2, 75.25, 'debit', 'TRADER JOES #123', 'Trader Joe''s',
		        'Groceries', false, true, false)
	`, acctID, txDate)

	txns, err := FetchTransactions(ctx, pool,
		time.Date(2026, 5, 1, 0, 0, 0, 0, time.UTC),
		time.Date(2026, 5, 31, 0, 0, 0, 0, time.UTC),
	)
	if err != nil {
		t.Fatalf("FetchTransactions: %v", err)
	}
	if len(txns) != 1 {
		t.Fatalf("expected 1 transaction, got %d", len(txns))
	}

	tx := txns[0]
	if tx.Amount != 75.25 {
		t.Errorf("Amount = %v, want 75.25", tx.Amount)
	}
	if tx.Direction != "debit" {
		t.Errorf("Direction = %q, want debit", tx.Direction)
	}
	// description_normal should take priority over description
	if tx.Description != "Trader Joe's" {
		t.Errorf("Description = %q, want 'Trader Joe''s'", tx.Description)
	}
	if tx.Category != "Groceries" {
		t.Errorf("Category = %q, want Groceries", tx.Category)
	}
	if !tx.IsRecurring {
		t.Error("IsRecurring should be true")
	}
	if tx.IsIncome {
		t.Error("IsIncome should be false")
	}
}

func TestListInstitutions_ReturnsSeedData(t *testing.T) {
	pool := testdb.New(t)
	ctx := context.Background()

	institutions, err := ListInstitutions(ctx, pool)
	if err != nil {
		t.Fatalf("ListInstitutions: %v", err)
	}
	// Seed data in 001_core.up.sql inserts affinity_fcu, sofi, chase.
	if len(institutions) != 3 {
		t.Fatalf("expected 3 seed institutions, got %d", len(institutions))
	}

	sources := make(map[string]bool)
	for _, inst := range institutions {
		sources[inst.Source] = true
		if inst.ID == "" {
			t.Errorf("institution %q has empty ID", inst.Source)
		}
		if inst.DisplayName == "" {
			t.Errorf("institution %q has empty DisplayName", inst.Source)
		}
	}
	for _, expected := range []string{"affinity_fcu", "sofi", "chase"} {
		if !sources[expected] {
			t.Errorf("missing institution source %q", expected)
		}
	}
}

func TestListInstitutions_ReflectsScrapeStatus(t *testing.T) {
	pool := testdb.New(t)
	ctx := context.Background()

	ranAt := time.Date(2026, 5, 17, 2, 0, 0, 0, time.UTC)
	_, err := pool.Exec(ctx, `
		UPDATE institutions SET last_scraped_at = $1, last_scrape_ok = true WHERE source = 'sofi'
	`, ranAt)
	if err != nil {
		t.Fatalf("update institution: %v", err)
	}

	institutions, err := ListInstitutions(ctx, pool)
	if err != nil {
		t.Fatalf("ListInstitutions: %v", err)
	}

	for _, inst := range institutions {
		if inst.Source == "sofi" {
			if inst.LastScrapedAt == nil {
				t.Error("expected LastScrapedAt to be set for sofi")
			}
			if inst.LastScrapeOk == nil || !*inst.LastScrapeOk {
				t.Error("expected LastScrapeOk = true for sofi")
			}
			return
		}
	}
	t.Error("sofi institution not found")
}

func TestInsertInsight_RoundTrip(t *testing.T) {
	pool := testdb.New(t)
	ctx := context.Background()

	ins := Insight{
		PeriodStart: time.Date(2026, 5, 1, 0, 0, 0, 0, time.UTC),
		PeriodEnd:   time.Date(2026, 5, 14, 0, 0, 0, 0, time.UTC),
		PeriodType:  "biweekly",
		RawAnalysis: "Spending was on track.",
		KeyFindings: []string{"Finding A", "Finding B", "Finding C"},
	}

	if err := InsertInsight(ctx, pool, ins); err != nil {
		t.Fatalf("InsertInsight: %v", err)
	}

	var count int
	pool.QueryRow(ctx, `SELECT count(*) FROM insights WHERE period_type = 'biweekly'`).Scan(&count)
	if count != 1 {
		t.Errorf("expected 1 insight row, got %d", count)
	}

	var rawAnalysis string
	var findings []string
	pool.QueryRow(ctx, `SELECT raw_analysis, key_findings FROM insights WHERE period_type = 'biweekly'`).
		Scan(&rawAnalysis, &findings)

	if rawAnalysis != ins.RawAnalysis {
		t.Errorf("raw_analysis = %q, want %q", rawAnalysis, ins.RawAnalysis)
	}
	if len(findings) != 3 || findings[0] != "Finding A" {
		t.Errorf("key_findings = %v", findings)
	}
}

func TestInsertInsight_EmptyKeyFindings(t *testing.T) {
	pool := testdb.New(t)
	ctx := context.Background()

	ins := Insight{
		PeriodStart: time.Date(2026, 4, 1, 0, 0, 0, 0, time.UTC),
		PeriodEnd:   time.Date(2026, 4, 30, 0, 0, 0, 0, time.UTC),
		PeriodType:  "monthly",
		RawAnalysis: "Quiet month.",
		KeyFindings: []string{},
	}

	if err := InsertInsight(ctx, pool, ins); err != nil {
		t.Fatalf("InsertInsight with empty findings: %v", err)
	}
}

func TestInsertInsight_InvalidPeriodType(t *testing.T) {
	pool := testdb.New(t)
	ctx := context.Background()

	ins := Insight{
		PeriodStart: time.Date(2026, 5, 1, 0, 0, 0, 0, time.UTC),
		PeriodEnd:   time.Date(2026, 5, 14, 0, 0, 0, 0, time.UTC),
		PeriodType:  "weekly", // not in CHECK constraint
		RawAnalysis: "Should fail.",
	}

	if err := InsertInsight(ctx, pool, ins); err == nil {
		t.Error("expected error for invalid period_type, got nil")
	}
}
