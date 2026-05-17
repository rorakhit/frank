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
	ID           string    `json:"id"`
	PeriodStart  time.Time `json:"period_start"`
	PeriodEnd    time.Time `json:"period_end"`
	PeriodType   string    `json:"period_type"` // "biweekly" | "monthly" | "yearly"
	RawAnalysis  string    `json:"raw_analysis"`
	KeyFindings  []string  `json:"key_findings"`
	ThinkingText string    `json:"thinking_text"`
	Model        string    `json:"model"`
	InputTokens  int       `json:"input_tokens"`
	OutputTokens int       `json:"output_tokens"`
	GeneratedAt  time.Time `json:"generated_at"`
}

type Account struct {
	ID             string     `json:"id"`
	InstitutionID  string     `json:"institution_id"`
	DisplayName    string     `json:"display_name"` // institution display name
	Name           string     `json:"name"`
	Type           string     `json:"type"`
	Mask           string     `json:"mask"`
	LatestBalance  *float64   `json:"latest_balance"`
	BalanceAt      *time.Time `json:"balance_at"`
}

type Goal struct {
	ID          string    `json:"id"`
	Type        string    `json:"type"`        // "savings_rate" | "spending_cap" | "free_text"
	Horizon     string    `json:"horizon"`     // "monthly" | "quarterly" | "yearly"
	Description string    `json:"description"`
	TargetValue *float64  `json:"target_value"`
	Category    string    `json:"category"`
	Active      bool      `json:"active"`
	CreatedAt   time.Time `json:"created_at"`
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
		INSERT INTO insights
		  (period_start, period_end, period_type, raw_analysis, key_findings,
		   thinking_text, model, input_tokens, output_tokens)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
	`, ins.PeriodStart, ins.PeriodEnd, ins.PeriodType, ins.RawAnalysis, findings,
		nullStr(ins.ThinkingText), nullStr(ins.Model), ins.InputTokens, ins.OutputTokens)
	if err != nil {
		return fmt.Errorf("insert insight: %w", err)
	}
	return nil
}

func ListInsights(ctx context.Context, pool *pgxpool.Pool) ([]Insight, error) {
	rows, err := pool.Query(ctx, `
		SELECT id, period_start, period_end, period_type, raw_analysis, key_findings,
		       COALESCE(thinking_text, ''), COALESCE(model, ''),
		       COALESCE(input_tokens, 0), COALESCE(output_tokens, 0), generated_at
		FROM insights
		ORDER BY generated_at DESC
	`)
	if err != nil {
		return nil, fmt.Errorf("list insights: %w", err)
	}
	defer rows.Close()

	var insights []Insight
	for rows.Next() {
		var ins Insight
		var findings []string
		if err := rows.Scan(
			&ins.ID, &ins.PeriodStart, &ins.PeriodEnd, &ins.PeriodType,
			&ins.RawAnalysis, &findings,
			&ins.ThinkingText, &ins.Model,
			&ins.InputTokens, &ins.OutputTokens, &ins.GeneratedAt,
		); err != nil {
			return nil, fmt.Errorf("scan insight: %w", err)
		}
		ins.KeyFindings = findings
		insights = append(insights, ins)
	}
	return insights, rows.Err()
}

func ListAccounts(ctx context.Context, pool *pgxpool.Pool) ([]Account, error) {
	rows, err := pool.Query(ctx, `
		SELECT
			a.id, a.institution_id, i.display_name, a.name, a.type, a.mask,
			bs.balance, bs.snapshot_at
		FROM accounts a
		JOIN institutions i ON i.id = a.institution_id
		LEFT JOIN LATERAL (
			SELECT balance, snapshot_at
			FROM balance_snapshots
			WHERE account_id = a.id
			ORDER BY snapshot_at DESC
			LIMIT 1
		) bs ON true
		ORDER BY i.display_name, a.name
	`)
	if err != nil {
		return nil, fmt.Errorf("list accounts: %w", err)
	}
	defer rows.Close()

	var accounts []Account
	for rows.Next() {
		var acct Account
		if err := rows.Scan(
			&acct.ID, &acct.InstitutionID, &acct.DisplayName,
			&acct.Name, &acct.Type, &acct.Mask,
			&acct.LatestBalance, &acct.BalanceAt,
		); err != nil {
			return nil, fmt.Errorf("scan account: %w", err)
		}
		accounts = append(accounts, acct)
	}
	return accounts, rows.Err()
}

func FetchActiveGoals(ctx context.Context, pool *pgxpool.Pool) ([]Goal, error) {
	rows, err := pool.Query(ctx, `
		SELECT id, type, horizon, description, target_value, COALESCE(category, ''), active, created_at
		FROM goals
		WHERE active = true
		ORDER BY created_at ASC
	`)
	if err != nil {
		return nil, fmt.Errorf("fetch active goals: %w", err)
	}
	defer rows.Close()
	return scanGoals(rows)
}

func ListGoals(ctx context.Context, pool *pgxpool.Pool) ([]Goal, error) {
	rows, err := pool.Query(ctx, `
		SELECT id, type, horizon, description, target_value, COALESCE(category, ''), active, created_at
		FROM goals
		ORDER BY active DESC, created_at ASC
	`)
	if err != nil {
		return nil, fmt.Errorf("list goals: %w", err)
	}
	defer rows.Close()
	return scanGoals(rows)
}

func InsertGoal(ctx context.Context, pool *pgxpool.Pool, g Goal) (Goal, error) {
	var created Goal
	var findings *string // unused placeholder
	_ = findings
	err := pool.QueryRow(ctx, `
		INSERT INTO goals (type, horizon, description, target_value, category)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING id, type, horizon, description, target_value, COALESCE(category, ''), active, created_at
	`, g.Type, g.Horizon, g.Description, g.TargetValue, nullStr(g.Category)).Scan(
		&created.ID, &created.Type, &created.Horizon, &created.Description,
		&created.TargetValue, &created.Category, &created.Active, &created.CreatedAt,
	)
	if err != nil {
		return Goal{}, fmt.Errorf("insert goal: %w", err)
	}
	return created, nil
}

func UpdateGoal(ctx context.Context, pool *pgxpool.Pool, id string, g Goal) (Goal, error) {
	var updated Goal
	err := pool.QueryRow(ctx, `
		UPDATE goals
		SET description = $2, target_value = $3, active = $4
		WHERE id = $1
		RETURNING id, type, horizon, description, target_value, COALESCE(category, ''), active, created_at
	`, id, g.Description, g.TargetValue, g.Active).Scan(
		&updated.ID, &updated.Type, &updated.Horizon, &updated.Description,
		&updated.TargetValue, &updated.Category, &updated.Active, &updated.CreatedAt,
	)
	if err != nil {
		return Goal{}, fmt.Errorf("update goal %q: %w", id, err)
	}
	return updated, nil
}

func DeactivateGoal(ctx context.Context, pool *pgxpool.Pool, id string) error {
	tag, err := pool.Exec(ctx, `UPDATE goals SET active = false WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("deactivate goal %q: %w", id, err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("goal %q not found", id)
	}
	return nil
}

func scanGoals(rows interface{ Next() bool; Scan(...any) error; Err() error }) ([]Goal, error) {
	var goals []Goal
	for rows.Next() {
		var g Goal
		if err := rows.Scan(
			&g.ID, &g.Type, &g.Horizon, &g.Description,
			&g.TargetValue, &g.Category, &g.Active, &g.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan goal: %w", err)
		}
		goals = append(goals, g)
	}
	return goals, rows.Err()
}

func nullStr(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}
