package db

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type Transaction struct {
	Date        time.Time
	Amount      float64
	Direction   string // "debit" | "credit"
	Description string
	Category    string
	IsIncome    bool
	IsRecurring bool
}

type Insight struct {
	PeriodStart time.Time
	PeriodEnd   time.Time
	PeriodType  string // "biweekly" | "monthly" | "yearly"
	RawAnalysis string
	KeyFindings []string
}

func FetchTransactions(ctx context.Context, pool *pgxpool.Pool, start, end time.Time) ([]Transaction, error) {
	rows, err := pool.Query(ctx, `
		SELECT
			t.date,
			t.amount::float8,
			t.direction,
			COALESCE(t.description_normal, t.description, ''),
			COALESCE(t.category, ''),
			t.is_income,
			t.is_recurring
		FROM transactions t
		WHERE t.date >= $1
		  AND t.date <= $2
		  AND t.is_pending = false
		ORDER BY t.date DESC
	`, start, end)
	if err != nil {
		return nil, fmt.Errorf("fetch transactions: %w", err)
	}
	defer rows.Close()

	var txns []Transaction
	for rows.Next() {
		var tx Transaction
		if err := rows.Scan(
			&tx.Date, &tx.Amount, &tx.Direction,
			&tx.Description, &tx.Category,
			&tx.IsIncome, &tx.IsRecurring,
		); err != nil {
			return nil, fmt.Errorf("scan transaction: %w", err)
		}
		txns = append(txns, tx)
	}
	return txns, rows.Err()
}

type Institution struct {
	ID              string     `json:"id"`
	Source          string     `json:"source"`
	DisplayName     string     `json:"display_name"`
	LastScrapedAt   *time.Time `json:"last_scraped_at"`
	LastScrapeOk    *bool      `json:"last_scrape_ok"`
	LastScrapeError *string    `json:"last_scrape_error"`
}

func ListInstitutions(ctx context.Context, pool *pgxpool.Pool) ([]Institution, error) {
	rows, err := pool.Query(ctx, `
		SELECT id, source, display_name, last_scraped_at, last_scrape_ok, last_scrape_error
		FROM institutions
		ORDER BY display_name
	`)
	if err != nil {
		return nil, fmt.Errorf("list institutions: %w", err)
	}
	defer rows.Close()

	var institutions []Institution
	for rows.Next() {
		var inst Institution
		if err := rows.Scan(
			&inst.ID, &inst.Source, &inst.DisplayName,
			&inst.LastScrapedAt, &inst.LastScrapeOk, &inst.LastScrapeError,
		); err != nil {
			return nil, fmt.Errorf("scan institution: %w", err)
		}
		institutions = append(institutions, inst)
	}
	return institutions, rows.Err()
}

func InsertInsight(ctx context.Context, pool *pgxpool.Pool, ins Insight) error {
	findings := make([]string, len(ins.KeyFindings))
	copy(findings, ins.KeyFindings)

	_, err := pool.Exec(ctx, `
		INSERT INTO insights (period_start, period_end, period_type, raw_analysis, key_findings)
		VALUES ($1, $2, $3, $4, $5)
	`, ins.PeriodStart, ins.PeriodEnd, ins.PeriodType, ins.RawAnalysis, findings)
	if err != nil {
		return fmt.Errorf("insert insight: %w", err)
	}
	return nil
}
