package db

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type Transaction struct {
	ID          string    `json:"id"`
	Date        time.Time `json:"date"`
	Amount      float64   `json:"amount"`
	Direction   string    `json:"direction"` // "debit" | "credit"
	Description string    `json:"description"`
	Category    string    `json:"category"`
	IsIncome    bool      `json:"is_income"`
	IsRecurring bool      `json:"is_recurring"`
	IsInternal  bool      `json:"is_internal"`
	Notes       string    `json:"notes"`
}

type CategorizationRule struct {
	ID          string    `json:"id"`
	Pattern     string    `json:"pattern"`
	Category    string    `json:"category"`
	IsRecurring bool      `json:"is_recurring"`
	Cadence     string    `json:"cadence"`
	IsInternal  bool      `json:"is_internal"`
	Notes       string    `json:"notes"`
	CreatedAt   time.Time `json:"created_at"`
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
			t.id,
			t.date,
			t.amount::float8,
			t.direction,
			COALESCE(t.description_normal, t.description, ''),
			COALESCE(t.category, ''),
			t.is_income,
			t.is_recurring,
			t.is_internal,
			t.notes
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
			&tx.ID, &tx.Date, &tx.Amount, &tx.Direction,
			&tx.Description, &tx.Category,
			&tx.IsIncome, &tx.IsRecurring, &tx.IsInternal,
			&tx.Notes,
		); err != nil {
			return nil, fmt.Errorf("scan transaction: %w", err)
		}
		txns = append(txns, tx)
	}
	return txns, rows.Err()
}

func ListCategorizationRules(ctx context.Context, pool *pgxpool.Pool) ([]CategorizationRule, error) {
	rows, err := pool.Query(ctx, `
		SELECT id, pattern, category, is_recurring, cadence, is_internal, notes, created_at
		FROM categorization_rules
		ORDER BY created_at ASC
	`)
	if err != nil {
		return nil, fmt.Errorf("list categorization rules: %w", err)
	}
	defer rows.Close()

	rules := []CategorizationRule{}
	for rows.Next() {
		var r CategorizationRule
		if err := rows.Scan(&r.ID, &r.Pattern, &r.Category, &r.IsRecurring, &r.Cadence, &r.IsInternal, &r.Notes, &r.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan rule: %w", err)
		}
		rules = append(rules, r)
	}
	return rules, rows.Err()
}

func UpsertCategorizationRule(ctx context.Context, pool *pgxpool.Pool, r CategorizationRule) (CategorizationRule, error) {
	var created CategorizationRule
	err := pool.QueryRow(ctx, `
		INSERT INTO categorization_rules (pattern, category, is_recurring, cadence, is_internal, notes)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING id, pattern, category, is_recurring, cadence, is_internal, notes, created_at
	`, r.Pattern, r.Category, r.IsRecurring, r.Cadence, r.IsInternal, r.Notes).Scan(
		&created.ID, &created.Pattern, &created.Category,
		&created.IsRecurring, &created.Cadence, &created.IsInternal,
		&created.Notes, &created.CreatedAt,
	)
	if err != nil {
		return CategorizationRule{}, fmt.Errorf("insert categorization rule: %w", err)
	}
	return created, nil
}

func UpdateCategorizationRule(ctx context.Context, pool *pgxpool.Pool, id string, r CategorizationRule) (CategorizationRule, error) {
	var updated CategorizationRule
	err := pool.QueryRow(ctx, `
		UPDATE categorization_rules
		SET pattern=$2, category=$3, is_recurring=$4, cadence=$5, is_internal=$6, notes=$7
		WHERE id=$1
		RETURNING id, pattern, category, is_recurring, cadence, is_internal, notes, created_at
	`, id, r.Pattern, r.Category, r.IsRecurring, r.Cadence, r.IsInternal, r.Notes).Scan(
		&updated.ID, &updated.Pattern, &updated.Category,
		&updated.IsRecurring, &updated.Cadence, &updated.IsInternal,
		&updated.Notes, &updated.CreatedAt,
	)
	if err != nil {
		return CategorizationRule{}, fmt.Errorf("update categorization rule %q: %w", id, err)
	}
	return updated, nil
}

func DeleteCategorizationRule(ctx context.Context, pool *pgxpool.Pool, id string) error {
	tag, err := pool.Exec(ctx, `DELETE FROM categorization_rules WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("delete categorization rule %q: %w", id, err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("rule %q not found", id)
	}
	return nil
}

// ApplyCategorizationRules applies all rules to the transactions table using ILIKE pattern matching.
// It updates category, is_recurring, cadence, and is_internal on matching rows.
func ApplyCategorizationRules(ctx context.Context, pool *pgxpool.Pool) (int64, error) {
	rules, err := ListCategorizationRules(ctx, pool)
	if err != nil {
		return 0, err
	}

	var total int64
	for _, r := range rules {
		tag, err := pool.Exec(ctx, `
			UPDATE transactions SET
				category    = CASE WHEN $2 != '' THEN $2 ELSE category END,
				is_recurring = CASE WHEN $3 THEN true ELSE is_recurring END,
				is_internal  = CASE WHEN $4 THEN true ELSE is_internal END
			WHERE description ILIKE '%' || $1 || '%'
			   OR raw_type ILIKE '%' || $1 || '%'
		`, r.Pattern, r.Category, r.IsRecurring, r.IsInternal)
		if err != nil {
			return total, fmt.Errorf("apply rule %q: %w", r.Pattern, err)
		}
		total += tag.RowsAffected()
	}
	return total, nil
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

	institutions := []Institution{}
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

	insights := []Insight{}
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

	accounts := []Account{}
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
	goals := []Goal{}
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

type CategorizationSuggestion struct {
	ID                     string     `json:"id"`
	SuggestionType         string     `json:"suggestion_type"` // "transaction" | "rule"
	Status                 string     `json:"status"`          // "pending" | "approved" | "dismissed"
	TransactionDescription *string    `json:"transaction_description"`
	TransactionDate        *string    `json:"transaction_date"`
	TransactionAmount      *float64   `json:"transaction_amount"`
	TransactionDirection   *string    `json:"transaction_direction"`
	Pattern                *string    `json:"pattern"`
	Category               string     `json:"category"`
	IsRecurring            bool       `json:"is_recurring"`
	Cadence                string     `json:"cadence"`
	IsInternal             bool       `json:"is_internal"`
	Confidence             int        `json:"confidence"`
	Notes                  string     `json:"notes"`
	CreatedAt              time.Time  `json:"created_at"`
	ReviewedAt             *time.Time `json:"reviewed_at"`
}

func ClearReviewedSuggestions(ctx context.Context, pool *pgxpool.Pool) error {
	_, err := pool.Exec(ctx, `DELETE FROM categorization_suggestions WHERE status != 'pending'`)
	return err
}

func InsertSuggestions(ctx context.Context, pool *pgxpool.Pool, suggestions []CategorizationSuggestion) error {
	for _, s := range suggestions {
		_, err := pool.Exec(ctx, `
			INSERT INTO categorization_suggestions
				(suggestion_type, transaction_description, transaction_date, transaction_amount,
				 transaction_direction, pattern, category, is_recurring, cadence, is_internal, confidence, notes)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
		`, s.SuggestionType, s.TransactionDescription, s.TransactionDate, s.TransactionAmount,
			s.TransactionDirection, s.Pattern, s.Category, s.IsRecurring, s.Cadence,
			s.IsInternal, s.Confidence, s.Notes)
		if err != nil {
			return fmt.Errorf("insert suggestion: %w", err)
		}
	}
	return nil
}

func ListPendingSuggestions(ctx context.Context, pool *pgxpool.Pool) ([]CategorizationSuggestion, error) {
	rows, err := pool.Query(ctx, `
		SELECT id, suggestion_type, status,
			transaction_description, transaction_date, transaction_amount::float8, transaction_direction,
			pattern, category, is_recurring, cadence, is_internal, confidence, notes, created_at, reviewed_at
		FROM categorization_suggestions
		WHERE status = 'pending'
		ORDER BY suggestion_type, confidence DESC, created_at ASC
	`)
	if err != nil {
		return nil, fmt.Errorf("list pending suggestions: %w", err)
	}
	defer rows.Close()

	out := []CategorizationSuggestion{}
	for rows.Next() {
		var s CategorizationSuggestion
		var txDate *string
		if err := rows.Scan(
			&s.ID, &s.SuggestionType, &s.Status,
			&s.TransactionDescription, &txDate, &s.TransactionAmount, &s.TransactionDirection,
			&s.Pattern, &s.Category, &s.IsRecurring, &s.Cadence, &s.IsInternal,
			&s.Confidence, &s.Notes, &s.CreatedAt, &s.ReviewedAt,
		); err != nil {
			return nil, fmt.Errorf("scan suggestion: %w", err)
		}
		s.TransactionDate = txDate
		out = append(out, s)
	}
	return out, rows.Err()
}

func ApproveSuggestion(ctx context.Context, pool *pgxpool.Pool, id string) (CategorizationSuggestion, error) {
	var s CategorizationSuggestion
	var txDate *string
	err := pool.QueryRow(ctx, `
		UPDATE categorization_suggestions SET status='approved', reviewed_at=now()
		WHERE id=$1 AND status='pending'
		RETURNING id, suggestion_type, status,
			transaction_description, transaction_date, transaction_amount::float8, transaction_direction,
			pattern, category, is_recurring, cadence, is_internal, confidence, notes, created_at, reviewed_at
	`, id).Scan(
		&s.ID, &s.SuggestionType, &s.Status,
		&s.TransactionDescription, &txDate, &s.TransactionAmount, &s.TransactionDirection,
		&s.Pattern, &s.Category, &s.IsRecurring, &s.Cadence, &s.IsInternal,
		&s.Confidence, &s.Notes, &s.CreatedAt, &s.ReviewedAt,
	)
	if err != nil {
		return CategorizationSuggestion{}, fmt.Errorf("approve suggestion %q: %w", id, err)
	}
	s.TransactionDate = txDate

	// Write through: apply the approved suggestion to the live tables
	if s.SuggestionType == "transaction" && s.TransactionDescription != nil {
		_, err = pool.Exec(ctx, `
			UPDATE transactions SET
				category     = CASE WHEN $2 != '' THEN $2 ELSE category END,
				is_recurring = CASE WHEN $3 THEN true ELSE is_recurring END,
				is_internal  = CASE WHEN $4 THEN true ELSE is_internal END
			WHERE COALESCE(description_normal, description) ILIKE $1
			  AND (category IS NULL OR category = '')
		`, "%"+*s.TransactionDescription+"%", s.Category, s.IsRecurring, s.IsInternal)
		if err != nil {
			return s, fmt.Errorf("apply transaction suggestion: %w", err)
		}
	}
	return s, nil
}

func DismissSuggestion(ctx context.Context, pool *pgxpool.Pool, id string) error {
	tag, err := pool.Exec(ctx, `
		UPDATE categorization_suggestions SET status='dismissed', reviewed_at=now()
		WHERE id=$1 AND status='pending'
	`, id)
	if err != nil {
		return fmt.Errorf("dismiss suggestion %q: %w", id, err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("suggestion %q not found or already reviewed", id)
	}
	return nil
}

func nullStr(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

func SetTransactionNote(ctx context.Context, pool *pgxpool.Pool, id, note string) error {
	tag, err := pool.Exec(ctx, `UPDATE transactions SET notes = $2 WHERE id = $1`, id, note)
	if err != nil {
		return fmt.Errorf("set transaction note %q: %w", id, err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("transaction %q not found", id)
	}
	return nil
}
