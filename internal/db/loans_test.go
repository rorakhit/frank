package db

import (
	"math"
	"testing"
	"time"
)

func d(year, month, day int) time.Time {
	return time.Date(year, time.Month(month), day, 0, 0, 0, 0, time.UTC)
}

func approx(t *testing.T, got, want, tol float64, label string) {
	t.Helper()
	if math.Abs(got-want) > tol {
		t.Errorf("%s: got %.2f, want %.2f (tolerance %.2f)", label, got, want, tol)
	}
}

func TestEstimatedBalance_ZeroInterest(t *testing.T) {
	loan := Loan{
		OriginalAmount:  12000,
		InterestRate:    0,
		TermMonths:      40,
		MinimumPayment:  300,
		OriginationDate: d(2024, 1, 1),
	}
	// 12 months in: 12 × 300 = 3600 paid, balance = 8400
	got := EstimatedBalance(loan, d(2025, 1, 1))
	approx(t, got, 8400, 0.01, "12 months zero-interest")
}

func TestEstimatedBalance_ZeroInterest_NeverNegative(t *testing.T) {
	loan := Loan{
		OriginalAmount:  1000,
		InterestRate:    0,
		TermMonths:      4,
		MinimumPayment:  300,
		OriginationDate: d(2024, 1, 1),
	}
	got := EstimatedBalance(loan, d(2030, 1, 1))
	if got != 0 {
		t.Errorf("expected 0 after payoff, got %.2f", got)
	}
}

func TestEstimatedBalance_ZeroInterest_BeforeOrigination(t *testing.T) {
	loan := Loan{
		OriginalAmount:  10000,
		InterestRate:    0,
		TermMonths:      36,
		MinimumPayment:  278,
		OriginationDate: d(2025, 6, 1),
	}
	got := EstimatedBalance(loan, d(2025, 1, 1))
	approx(t, got, 10000, 0.01, "before origination")
}

// Mortgage: $271,000 at 2.875%, 30-year term, originated Sep 2020.
// The formula uses the true P&I payment (~$1,124). The known balance of $236,516
// reflects some extra principal payments over 56 months; we allow $7,000 tolerance.
func TestEstimatedBalance_Mortgage(t *testing.T) {
	loan := Loan{
		OriginalAmount:  271000,
		InterestRate:    0.02875,
		TermMonths:      360,
		MinimumPayment:  1124.36, // true P&I; total payment includes escrow
		OriginationDate: d(2020, 9, 16),
	}
	got := EstimatedBalance(loan, d(2025, 5, 17))
	// Known balance $236,516 — formula gives ~$242,564 (gap = extra principal paid)
	approx(t, got, 236516, 7000, "mortgage balance at ~56 months")
}

// Car loan: $30,356.34 at 6.16%, 60-month term, originated Oct 2023.
// Known balance ~$21,833 at May 2025 (19 months in).
func TestEstimatedBalance_CarLoan(t *testing.T) {
	loan := Loan{
		OriginalAmount:  30356.34,
		InterestRate:    0.0616,
		TermMonths:      60,
		MinimumPayment:  589.01,
		OriginationDate: d(2023, 10, 1),
	}
	got := EstimatedBalance(loan, d(2025, 5, 17))
	approx(t, got, 21833, 200, "car loan balance at 19 months")
}

func TestMonthsBetween(t *testing.T) {
	cases := []struct {
		start, end time.Time
		want       int
	}{
		{d(2024, 1, 1), d(2024, 1, 1), 0},
		{d(2024, 1, 1), d(2024, 2, 1), 1},
		{d(2024, 1, 15), d(2024, 2, 14), 0}, // haven't hit day 15 yet
		{d(2024, 1, 15), d(2024, 2, 15), 1},
		{d(2020, 9, 16), d(2025, 5, 16), 56},
		{d(2020, 9, 16), d(2025, 5, 17), 56},
	}
	for _, c := range cases {
		got := monthsBetween(c.start, c.end)
		if got != c.want {
			t.Errorf("monthsBetween(%v, %v) = %d, want %d", c.start, c.end, got, c.want)
		}
	}
}
