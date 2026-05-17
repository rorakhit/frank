package insights

import (
	"fmt"
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

key_findings should be 3-5 items: specific observations with numbers, anomalies, recurring charges worth noting, or trends. Do not pad with generic advice.`

type PeriodSummary struct {
	PeriodType   string
	Start        time.Time
	End          time.Time
	Transactions []db.Transaction
}

func BuildPrompts(p PeriodSummary) (system, user string) {
	system = systemPrompt

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
