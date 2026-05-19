package db

import (
	"context"
	"fmt"
	"math"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type Loan struct {
	ID              string    `json:"id"`
	Name            string    `json:"name"`
	Lender          string    `json:"lender"`
	OriginalAmount  float64   `json:"original_amount"`
	InterestRate    float64   `json:"interest_rate"` // annual, as decimal (e.g. 0.02875)
	TermMonths      int       `json:"term_months"`
	MinimumPayment  float64   `json:"minimum_payment"`
	OriginationDate time.Time `json:"origination_date"`
	AccountSource   string    `json:"account_source"`
	Notes           string    `json:"notes"`
}

type CreditAccount struct {
	ID             string  `json:"id"`
	Name           string  `json:"name"`
	Lender         string  `json:"lender"`
	CreditLimit    float64 `json:"credit_limit"`
	CurrentBalance float64 `json:"current_balance"`
	InterestRate   float64 `json:"interest_rate"` // APR as decimal
	MinimumPayment float64 `json:"minimum_payment"`
	DueDay         int     `json:"due_day"`
	Notes          string  `json:"notes"`
}

// EstimatedBalance computes the remaining loan balance as of asOf using standard
// amortization. For 0% loans it is simply original - (payments_made × monthly_payment).
func EstimatedBalance(loan Loan, asOf time.Time) float64 {
	monthsElapsed := monthsBetween(loan.OriginationDate, asOf)
	if monthsElapsed <= 0 {
		return loan.OriginalAmount
	}
	if monthsElapsed >= loan.TermMonths {
		return 0
	}

	// 0% interest — straight-line paydown
	if loan.InterestRate == 0 {
		paid := float64(monthsElapsed) * loan.MinimumPayment
		balance := loan.OriginalAmount - paid
		if balance < 0 {
			return 0
		}
		return math.Round(balance*100) / 100
	}

	// Standard amortization: B = P×(1+r)^n - PMT×((1+r)^n - 1)/r
	r := loan.InterestRate / 12
	n := float64(monthsElapsed)
	factor := math.Pow(1+r, n)
	balance := loan.OriginalAmount*factor - loan.MinimumPayment*(factor-1)/r
	if balance < 0 {
		return 0
	}
	return math.Round(balance*100) / 100
}

// monthsBetween returns the number of whole months from start to end.
func monthsBetween(start, end time.Time) int {
	years := end.Year() - start.Year()
	months := int(end.Month()) - int(start.Month())
	total := years*12 + months
	// If we haven't reached the same day-of-month yet this month, don't count it
	if end.Day() < start.Day() {
		total--
	}
	return total
}

func ListLoans(ctx context.Context, pool *pgxpool.Pool) ([]Loan, error) {
	rows, err := pool.Query(ctx, `
		SELECT id, name, lender, original_amount::float8, interest_rate::float8,
		       term_months, minimum_payment::float8, origination_date,
		       COALESCE(account_source, ''), COALESCE(notes, '')
		FROM loans
		WHERE active = true
		ORDER BY origination_date
	`)
	if err != nil {
		return nil, fmt.Errorf("list loans: %w", err)
	}
	defer rows.Close()

	loans := []Loan{}
	for rows.Next() {
		var l Loan
		if err := rows.Scan(
			&l.ID, &l.Name, &l.Lender, &l.OriginalAmount, &l.InterestRate,
			&l.TermMonths, &l.MinimumPayment, &l.OriginationDate,
			&l.AccountSource, &l.Notes,
		); err != nil {
			return nil, fmt.Errorf("scan loan: %w", err)
		}
		loans = append(loans, l)
	}
	return loans, rows.Err()
}

func ListCreditAccounts(ctx context.Context, pool *pgxpool.Pool) ([]CreditAccount, error) {
	rows, err := pool.Query(ctx, `
		SELECT id, name, lender, credit_limit::float8, current_balance::float8,
		       interest_rate::float8, COALESCE(minimum_payment::float8, 0),
		       COALESCE(due_day, 0), COALESCE(notes, '')
		FROM credit_accounts
		WHERE active = true
		ORDER BY name
	`)
	if err != nil {
		return nil, fmt.Errorf("list credit accounts: %w", err)
	}
	defer rows.Close()

	accounts := []CreditAccount{}
	for rows.Next() {
		var a CreditAccount
		if err := rows.Scan(
			&a.ID, &a.Name, &a.Lender, &a.CreditLimit, &a.CurrentBalance,
			&a.InterestRate, &a.MinimumPayment, &a.DueDay, &a.Notes,
		); err != nil {
			return nil, fmt.Errorf("scan credit account: %w", err)
		}
		accounts = append(accounts, a)
	}
	return accounts, rows.Err()
}
