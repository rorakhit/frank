package insights

import (
	"strings"
	"testing"
	"time"

	"github.com/rorakhit/frank/internal/db"
)

var baseDate = time.Date(2026, 5, 1, 0, 0, 0, 0, time.UTC)

func makeTx(date time.Time, amount float64, direction, desc, category string, isIncome, isRecurring bool) db.Transaction {
	return db.Transaction{
		Date:        date,
		Amount:      amount,
		Direction:   direction,
		Description: desc,
		Category:    category,
		IsIncome:    isIncome,
		IsRecurring: isRecurring,
	}
}

func TestBuildPrompts_SystemPromptUnchanged(t *testing.T) {
	sys, _ := BuildPrompts(PeriodSummary{
		PeriodType:   "biweekly",
		Start:        baseDate,
		End:          baseDate.AddDate(0, 0, 14),
		Transactions: nil,
	})
	if !strings.Contains(sys, "personal finance analyst") {
		t.Error("system prompt missing expected content")
	}
	if !strings.Contains(sys, `"raw_analysis"`) {
		t.Error("system prompt must instruct Claude on JSON structure")
	}
}

func TestBuildPrompts_TotalsCorrect(t *testing.T) {
	txns := []db.Transaction{
		makeTx(baseDate, 50.00, "debit", "Grocery Store", "Groceries", false, false),
		makeTx(baseDate, 30.00, "debit", "Gas Station", "Transport", false, false),
		makeTx(baseDate, 2000.00, "credit", "Paycheck", "", true, false),
	}
	_, user := BuildPrompts(PeriodSummary{
		PeriodType:   "biweekly",
		Start:        baseDate,
		End:          baseDate.AddDate(0, 0, 14),
		Transactions: txns,
	})

	if !strings.Contains(user, "Total spend: $80.00") {
		t.Errorf("expected total spend $80.00 in prompt, got:\n%s", user)
	}
	if !strings.Contains(user, "Total income/credits: $2000.00") {
		t.Errorf("expected total income $2000.00 in prompt, got:\n%s", user)
	}
	if !strings.Contains(user, "Net: $1920.00") {
		t.Errorf("expected net $1920.00 in prompt, got:\n%s", user)
	}
}

func TestBuildPrompts_CategoryAggregation(t *testing.T) {
	txns := []db.Transaction{
		makeTx(baseDate, 40.00, "debit", "Trader Joe's", "Groceries", false, false),
		makeTx(baseDate, 25.00, "debit", "Whole Foods", "Groceries", false, false),
		makeTx(baseDate, 15.00, "debit", "Shell", "Transport", false, false),
	}
	_, user := BuildPrompts(PeriodSummary{
		PeriodType:   "monthly",
		Start:        baseDate,
		End:          baseDate.AddDate(0, 1, 0),
		Transactions: txns,
	})

	if !strings.Contains(user, "Groceries") {
		t.Error("expected Groceries category in prompt")
	}
	if !strings.Contains(user, "$65.00") {
		t.Errorf("expected aggregated Groceries total $65.00, prompt:\n%s", user)
	}
}

func TestBuildPrompts_UncategorizedFallback(t *testing.T) {
	txns := []db.Transaction{
		makeTx(baseDate, 12.50, "debit", "Mystery Charge", "", false, false),
	}
	_, user := BuildPrompts(PeriodSummary{
		PeriodType:   "biweekly",
		Start:        baseDate,
		End:          baseDate.AddDate(0, 0, 14),
		Transactions: txns,
	})

	if !strings.Contains(user, "Uncategorized") {
		t.Error("expected 'Uncategorized' for transaction with empty category")
	}
}

func TestBuildPrompts_RecurringSection(t *testing.T) {
	txns := []db.Transaction{
		makeTx(baseDate, 15.99, "debit", "Netflix", "Entertainment", false, true),
		makeTx(baseDate, 9.99, "debit", "Spotify", "Entertainment", false, true),
		makeTx(baseDate, 50.00, "debit", "One-off purchase", "Shopping", false, false),
	}
	_, user := BuildPrompts(PeriodSummary{
		PeriodType:   "biweekly",
		Start:        baseDate,
		End:          baseDate.AddDate(0, 0, 14),
		Transactions: txns,
	})

	if !strings.Contains(user, "Recurring charges this period") {
		t.Error("expected recurring section header")
	}
	if !strings.Contains(user, "Netflix") {
		t.Error("expected Netflix in recurring section")
	}
	if !strings.Contains(user, "Spotify") {
		t.Error("expected Spotify in recurring section")
	}
}

func TestBuildPrompts_NoRecurringSectionWhenNone(t *testing.T) {
	txns := []db.Transaction{
		makeTx(baseDate, 50.00, "debit", "Random Store", "Shopping", false, false),
	}
	_, user := BuildPrompts(PeriodSummary{
		PeriodType:   "biweekly",
		Start:        baseDate,
		End:          baseDate.AddDate(0, 0, 14),
		Transactions: txns,
	})

	if strings.Contains(user, "Recurring charges this period") {
		t.Error("recurring section should not appear when no recurring transactions")
	}
}

func TestBuildPrompts_PeriodHeader(t *testing.T) {
	start := time.Date(2026, 5, 1, 0, 0, 0, 0, time.UTC)
	end := time.Date(2026, 5, 14, 0, 0, 0, 0, time.UTC)
	_, user := BuildPrompts(PeriodSummary{
		PeriodType: "biweekly",
		Start:      start,
		End:        end,
	})

	if !strings.Contains(user, "biweekly") {
		t.Error("expected period type in prompt header")
	}
	if !strings.Contains(user, "May 1, 2026") {
		t.Error("expected start date in prompt header")
	}
	if !strings.Contains(user, "May 14, 2026") {
		t.Error("expected end date in prompt header")
	}
}

func TestBuildPrompts_TransactionTable(t *testing.T) {
	txns := []db.Transaction{
		makeTx(time.Date(2026, 5, 3, 0, 0, 0, 0, time.UTC), 42.00, "debit", "Amazon", "Shopping", false, false),
	}
	_, user := BuildPrompts(PeriodSummary{
		PeriodType:   "biweekly",
		Start:        baseDate,
		End:          baseDate.AddDate(0, 0, 14),
		Transactions: txns,
	})

	if !strings.Contains(user, "2026-05-03") {
		t.Error("expected ISO date in transaction table")
	}
	if !strings.Contains(user, "Amazon") {
		t.Error("expected description in transaction table")
	}
	if !strings.Contains(user, "-$42.00") {
		t.Error("expected debit amount with minus sign in table")
	}
}

func TestBuildPrompts_CreditSignPositive(t *testing.T) {
	txns := []db.Transaction{
		makeTx(baseDate, 500.00, "credit", "Refund", "", false, false),
	}
	_, user := BuildPrompts(PeriodSummary{
		PeriodType:   "biweekly",
		Start:        baseDate,
		End:          baseDate.AddDate(0, 0, 14),
		Transactions: txns,
	})

	if !strings.Contains(user, "+$500.00") {
		t.Error("expected credit amount with plus sign in table")
	}
}

func TestBuildPrompts_EmptyTransactions(t *testing.T) {
	_, user := BuildPrompts(PeriodSummary{
		PeriodType:   "biweekly",
		Start:        baseDate,
		End:          baseDate.AddDate(0, 0, 14),
		Transactions: nil,
	})
	if !strings.Contains(user, "Total transactions: 0") {
		t.Error("expected 0 transaction count for empty period")
	}
	if !strings.Contains(user, "Total spend: $0.00") {
		t.Error("expected zero spend for empty period")
	}
	if strings.Contains(user, "Recurring charges this period") {
		t.Error("recurring section should not appear for empty period")
	}
}

func TestBuildPrompts_TransactionCountInHeader(t *testing.T) {
	txns := []db.Transaction{
		makeTx(baseDate, 10.00, "debit", "A", "Food", false, false),
		makeTx(baseDate, 20.00, "debit", "B", "Food", false, false),
		makeTx(baseDate, 30.00, "credit", "C", "", false, false),
	}
	_, user := BuildPrompts(PeriodSummary{
		PeriodType:   "monthly",
		Start:        baseDate,
		End:          baseDate.AddDate(0, 1, 0),
		Transactions: txns,
	})
	if !strings.Contains(user, "Total transactions: 3") {
		t.Errorf("expected transaction count of 3, got prompt:\n%s", user)
	}
}

func TestBuildPrompts_CreditNotCountedInCategorySpend(t *testing.T) {
	txns := []db.Transaction{
		makeTx(baseDate, 500.00, "credit", "Refund", "Shopping", false, false),
		makeTx(baseDate, 100.00, "debit", "Store", "Shopping", false, false),
	}
	_, user := BuildPrompts(PeriodSummary{
		PeriodType:   "biweekly",
		Start:        baseDate,
		End:          baseDate.AddDate(0, 0, 14),
		Transactions: txns,
	})
	// Only the debit should appear in category spend ($100, not $600)
	if !strings.Contains(user, "$100.00") {
		t.Errorf("expected only debit in category spend, got:\n%s", user)
	}
	// $500 credit should not inflate category totals
	if strings.Contains(user, "$600.00") {
		t.Error("credit transaction should not be counted in category spend")
	}
}

func TestBuildPrompts_IsIncomeCreditExcludedFromCategorySpend(t *testing.T) {
	txns := []db.Transaction{
		makeTx(baseDate, 2000.00, "credit", "Paycheck", "Income", true, false),
		makeTx(baseDate, 50.00, "debit", "Coffee", "Food", false, false),
	}
	_, user := BuildPrompts(PeriodSummary{
		PeriodType:   "biweekly",
		Start:        baseDate,
		End:          baseDate.AddDate(0, 0, 14),
		Transactions: txns,
	})
	if strings.Contains(user, "Income") && strings.Contains(user, "$2000.00") {
		// Only a problem if "Income" appears in the category spend section
		// (it's fine in the transaction table). Check it doesn't appear there.
		catSection := extractCategorySection(user)
		if strings.Contains(catSection, "Income") {
			t.Error("income transaction should not appear in category spend section")
		}
	}
}

func TestBuildPrompts_RecurringIncludesIncomeTransactions(t *testing.T) {
	txns := []db.Transaction{
		makeTx(baseDate, 2000.00, "credit", "Salary", "Income", true, true),
		makeTx(baseDate, 15.99, "debit", "Netflix", "Entertainment", false, true),
	}
	_, user := BuildPrompts(PeriodSummary{
		PeriodType:   "biweekly",
		Start:        baseDate,
		End:          baseDate.AddDate(0, 0, 14),
		Transactions: txns,
	})
	if !strings.Contains(user, "Recurring charges this period") {
		t.Error("expected recurring section")
	}
	if !strings.Contains(user, "Salary") {
		t.Error("recurring income should appear in recurring section")
	}
	if !strings.Contains(user, "Netflix") {
		t.Error("recurring debit should appear in recurring section")
	}
}

func TestBuildPrompts_NetNegativeWhenSpendExceedsIncome(t *testing.T) {
	txns := []db.Transaction{
		makeTx(baseDate, 500.00, "credit", "Paycheck", "", true, false),
		makeTx(baseDate, 800.00, "debit", "Rent", "Housing", false, false),
	}
	_, user := BuildPrompts(PeriodSummary{
		PeriodType:   "biweekly",
		Start:        baseDate,
		End:          baseDate.AddDate(0, 0, 14),
		Transactions: txns,
	})
	if !strings.Contains(user, "Net: $-300.00") {
		t.Errorf("expected negative net, got prompt:\n%s", user)
	}
}

// extractCategorySection returns the text between "Spend by category:" and the next blank line.
func extractCategorySection(user string) string {
	start := strings.Index(user, "Spend by category:")
	if start == -1 {
		return ""
	}
	sub := user[start:]
	end := strings.Index(sub, "\n\n")
	if end == -1 {
		return sub
	}
	return sub[:end]
}

func TestTruncate(t *testing.T) {
	cases := []struct {
		input string
		n     int
		want  string
	}{
		{"short", 10, "short"},
		{"exactly10c", 10, "exactly10c"},
		{"this is a longer string", 10, "this is a…"},
		{"", 5, ""},
	}
	for _, c := range cases {
		got := truncate(c.input, c.n)
		if got != c.want {
			t.Errorf("truncate(%q, %d) = %q, want %q", c.input, c.n, got, c.want)
		}
	}
}
