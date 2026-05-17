package db

import (
	"context"
	"fmt"
	"math"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type Loan struct {
	ID              string
	Name            string
	Lender          string
	OriginalAmount  float64
	InterestRate    float64 // annual, as decimal (e.g. 0.02875)
	TermMonths      int
	MinimumPayment  float64
	OriginationDate time.Time
	AccountSource   string
	Notes           string
}

type CreditAccount struct {
	ID             string
	Name           string
	Lender         string
	CreditLimit    float64
	CurrentBalance float64
	InterestRate   float64 // APR as decimal
	MinimumPayment float64
	DueDay         int
	Notes          string
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

	var loans []Loan
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

	var accounts []CreditAccount
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
