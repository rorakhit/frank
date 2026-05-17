package insights

import (
	"fmt"
	"math"
	"strings"
	"time"

	"github.com/rorakhit/frank/internal/db"
)

const systemPrompt = `You are a personal finance analyst for a single person who tracks their spending across three accounts:
- Affinity FCU (credit union — checking and savings)
- SoFi (checking and savings)
- Chase Sapphire Preferred (credit card)

Your job is to analyze a period of transactions and provide clear, honest, actionable insights. Be direct and specific — use real numbers from the data. Avoid generic personal-finance advice.

You must respond with valid JSON in exactly this structure:
{
  "raw_analysis": "<2-3 paragraph narrative analysis of the period>",
  "key_findings": ["<finding 1>", "<finding 2>", "<finding 3>", ...]
}

key_findings should be 3-5 items: specific observations with numbers, anomalies, recurring charges worth noting, or trends. Do not pad with generic advice.

If active goals are present, comment on progress toward each one in the narrative and include at least one concrete, specific suggestion per goal in key_findings.`

type GoalContext struct {
	Description  string
	Type         string
	Horizon      string
	TargetValue  *float64
	Category     string
	CurrentValue *float64 // nil for free_text
	Unit         string   // "%" for savings_rate, "$" for spending_cap
}

type PeriodSummary struct {
	PeriodType     string
	Start          time.Time
	End            time.Time
	Transactions   []db.Transaction
	Loans          []db.Loan          // populated for yearly period only
	CreditAccounts []db.CreditAccount // populated for yearly period only
	Goals          []GoalContext
}

func BuildPrompts(p PeriodSummary, userContext string) (system, user string) {
	system = systemPrompt
	if userContext != "" {
		system += "\n\n## User Context\n\n" + userContext
	}

	var totalSpend, totalIncome float64
	categorySpend := map[string]float64{}
	var recurring []db.Transaction

	for _, tx := range p.Transactions {
		if tx.IsIncome || tx.Direction == "credit" {
			totalIncome += tx.Amount
		} else {
			totalSpend += tx.Amount
			cat := tx.Category
			if cat == "" {
				cat = "Uncategorized"
			}
			categorySpend[cat] += tx.Amount
		}
		if tx.IsRecurring {
			recurring = append(recurring, tx)
		}
	}

	var sb strings.Builder
	fmt.Fprintf(&sb, "Period: %s (%s to %s)\n",
		p.PeriodType,
		p.Start.Format("Jan 2, 2006"),
		p.End.Format("Jan 2, 2006"),
	)
	fmt.Fprintf(&sb, "Total transactions: %d\n", len(p.Transactions))
	fmt.Fprintf(&sb, "Total spend: $%.2f\n", totalSpend)
	fmt.Fprintf(&sb, "Total income/credits: $%.2f\n", totalIncome)
	fmt.Fprintf(&sb, "Net: $%.2f\n\n", totalIncome-totalSpend)

	if len(categorySpend) > 0 {
		sb.WriteString("Spend by category:\n")
		for cat, amt := range categorySpend {
			fmt.Fprintf(&sb, "  %-25s $%.2f\n", cat, amt)
		}
		sb.WriteString("\n")
	}

	if len(recurring) > 0 {
		sb.WriteString("Recurring charges this period:\n")
		for _, tx := range recurring {
			fmt.Fprintf(&sb, "  %-35s $%.2f\n", tx.Description, tx.Amount)
		}
		sb.WriteString("\n")
	}

	if len(p.Loans) > 0 || len(p.CreditAccounts) > 0 {
		now := p.End
		sb.WriteString("Outstanding debt as of end of period:\n\n")

		if len(p.Loans) > 0 {
			sb.WriteString("Installment loans:\n")
			fmt.Fprintf(&sb, "  %-25s  %-18s  %8s  %8s  %10s  %10s  %s\n",
				"Name", "Lender", "Original", "Rate", "Payment", "Est.Balance", "Payoff")
			sb.WriteString("  " + strings.Repeat("-", 100) + "\n")
			for _, l := range p.Loans {
				balance := db.EstimatedBalance(l, now)
				monthsLeft := 0
				if l.MinimumPayment > 0 && balance > 0 {
					if l.InterestRate == 0 {
						monthsLeft = int(math.Ceil(balance / l.MinimumPayment))
					} else {
						r := l.InterestRate / 12
						// n = -log(1 - r*B/PMT) / log(1+r)
						x := 1 - r*balance/l.MinimumPayment
						if x > 0 {
							monthsLeft = int(math.Ceil(-math.Log(x) / math.Log(1+r)))
						}
					}
				}
				payoffDate := now.AddDate(0, monthsLeft, 0)
				fmt.Fprintf(&sb, "  %-25s  %-18s  %8.0f  %7.3f%%  %10.2f  %10.2f  %s\n",
					l.Name, l.Lender, l.OriginalAmount, l.InterestRate*100,
					l.MinimumPayment, balance, payoffDate.Format("Jan 2006"),
				)
			}
			sb.WriteString("\n")
		}

		if len(p.CreditAccounts) > 0 {
			sb.WriteString("Credit accounts:\n")
			fmt.Fprintf(&sb, "  %-25s  %-18s  %8s  %8s  %8s  %10s\n",
				"Name", "Lender", "Limit", "Balance", "Util%", "APR")
			sb.WriteString("  " + strings.Repeat("-", 90) + "\n")
			for _, a := range p.CreditAccounts {
				util := 0.0
				if a.CreditLimit > 0 {
					util = a.CurrentBalance / a.CreditLimit * 100
				}
				fmt.Fprintf(&sb, "  %-25s  %-18s  %8.0f  %8.2f  %7.1f%%  %9.3f%%\n",
					a.Name, a.Lender, a.CreditLimit, a.CurrentBalance, util, a.InterestRate*100,
				)
			}
			sb.WriteString("\n")
		}
	}

	if len(p.Goals) > 0 {
		sb.WriteString("Active goals:\n")
		for _, g := range p.Goals {
			line := fmt.Sprintf("  [%s / %s] %s", g.Type, g.Horizon, g.Description)
			if g.TargetValue != nil && g.CurrentValue != nil {
				line += fmt.Sprintf(" — target: %s%.2f, current: %s%.2f",
					g.Unit, *g.TargetValue, g.Unit, *g.CurrentValue)
			} else if g.TargetValue != nil {
				line += fmt.Sprintf(" — target: %s%.2f", g.Unit, *g.TargetValue)
			}
			sb.WriteString(line + "\n")
		}
		sb.WriteString("\n")
	}

	sb.WriteString("All transactions:\n")
	sb.WriteString(fmt.Sprintf("%-12s  %-8s  %-35s  %s\n", "Date", "Amount", "Description", "Category"))
	sb.WriteString(strings.Repeat("-", 80) + "\n")
	for _, tx := range p.Transactions {
		sign := "-"
		if tx.IsIncome || tx.Direction == "credit" {
			sign = "+"
		}
		cat := tx.Category
		if cat == "" {
			cat = "—"
		}
		fmt.Fprintf(&sb, "%-12s  %s$%-7.2f  %-35s  %s\n",
			tx.Date.Format("2006-01-02"),
			sign,
			tx.Amount,
			truncate(tx.Description, 35),
			cat,
		)
	}

	sb.WriteString("\nAnalyze this period and respond with JSON as instructed.")

	return system, sb.String()
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n-1] + "…"
}
