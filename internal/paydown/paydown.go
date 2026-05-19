package paydown

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/anthropics/anthropic-sdk-go"
	"github.com/anthropics/anthropic-sdk-go/option"
	"github.com/rorakhit/frank/internal/db"
)

const model = "claude-sonnet-4-6"

type Strategy struct {
	Narrative    string       `json:"narrative"`
	Priority     []DebtItem   `json:"priority"`
	Milestones   []Milestone  `json:"milestones"`
	FreeCashFlow float64      `json:"free_cash_flow"`
}

type DebtItem struct {
	Name           string  `json:"name"`
	Balance        float64 `json:"balance"`
	Rate           float64 `json:"rate"`
	MinPayment     float64 `json:"min_payment"`
	Recommended    float64 `json:"recommended_payment"`
	Reasoning      string  `json:"reasoning"`
	MonthsToPayoff int     `json:"months_to_payoff"`
}

type Milestone struct {
	Description string `json:"description"`
	TargetMonth string `json:"target_month"` // "YYYY-MM"
}

const systemPrompt = `You are a personal finance paydown strategist. Given a snapshot of someone's debt and their recent cash flow, produce a concrete, prioritized paydown plan.

Respond with valid JSON in exactly this structure:
{
  "narrative": "<2-3 paragraph strategy explanation — be direct, use real numbers, explain the rationale for priority order>",
  "priority": [
    {
      "name": "<debt name>",
      "balance": <current balance as number>,
      "rate": <APR as decimal, e.g. 0.2499>,
      "min_payment": <minimum monthly payment>,
      "recommended_payment": <what they should actually pay per month>,
      "reasoning": "<1 sentence: why this priority and this payment amount>",
      "months_to_payoff": <estimated months at recommended payment>
    }
  ],
  "milestones": [
    {
      "description": "<specific milestone, e.g. 'Chase balance below $2,000'>",
      "target_month": "<YYYY-MM>"
    }
  ],
  "free_cash_flow": <estimated monthly dollars available for extra debt payments>
}

Priority rules:
- Use avalanche method (highest APR first) unless a 0% or very low-rate debt has a looming payoff deadline — flag that explicitly
- For credit cards at 0% or with very low balances that could be cleared quickly, note the psychological and score benefit
- If free_cash_flow is negative or very tight, say so clearly and recommend the minimum path
- milestones: 3-5 specific, achievable checkpoints — not vague goals like "pay off credit card" but "Chase balance below $1,500 by August 2026"
- Do not recommend paying off a 0% loan aggressively if that cash could retire high-APR credit card debt first

Everyday spending analysis:
- Factor category spend into the strategy — grocery, dining, shopping, subscriptions are all levers
- Look for signals in uncategorized transactions that suggest spending patterns (e.g. restaurant names, delivery apps, retail stores)
- If any category looks elevated relative to the free cash flow, call it out specifically with the dollar amount and a concrete suggestion (e.g. "Food and Drink at $X is your second-largest discretionary category — trimming $50/mo accelerates Chase payoff by N weeks")
- Do not moralize — be specific and actionable, not judgmental`

// Generate calls Claude with the full debt + cash flow context and returns a paydown strategy.
func Generate(ctx context.Context, apiKey string, loans []db.Loan, credits []db.CreditAccount, txns []db.Transaction, asOf time.Time, userContext string) (Strategy, error) {
	c := anthropic.NewClient(option.WithAPIKey(apiKey))

	prompt := buildPrompt(loans, credits, txns, asOf, userContext)
	msg, err := c.Messages.New(ctx, anthropic.MessageNewParams{
		Model:     anthropic.Model(model),
		MaxTokens: 4096,
		System: []anthropic.TextBlockParam{
			{Text: systemPrompt},
		},
		Messages: []anthropic.MessageParam{
			anthropic.NewUserMessage(anthropic.NewTextBlock(prompt)),
		},
	})
	if err != nil {
		return Strategy{}, fmt.Errorf("claude api: %w", err)
	}

	var raw string
	for _, block := range msg.Content {
		if block.Type == "text" {
			raw = block.Text
			break
		}
	}

	return parseResponse(raw)
}

func buildPrompt(loans []db.Loan, credits []db.CreditAccount, txns []db.Transaction, asOf time.Time, userContext string) string {
	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("## Snapshot date: %s\n\n", asOf.Format("2006-01-02")))

	if len(credits) > 0 {
		sb.WriteString("## Credit cards\n\n")
		for _, c := range credits {
			apr := c.InterestRate * 100
			sb.WriteString(fmt.Sprintf("- %s (%s): balance=$%.2f  limit=$%.2f  APR=%.2f%%  min_payment=$%.2f/mo",
				c.Name, c.Lender, c.CurrentBalance, c.CreditLimit, apr, c.MinimumPayment))
			if c.Notes != "" {
				sb.WriteString(fmt.Sprintf("  notes=%q", c.Notes))
			}
			sb.WriteString("\n")
		}
		sb.WriteString("\n")
	}

	if len(loans) > 0 {
		sb.WriteString("## Installment loans\n\n")
		for _, l := range loans {
			balance := db.EstimatedBalance(l, asOf)
			apr := l.InterestRate * 100
			monthsLeft := l.TermMonths - monthsBetween(l.OriginationDate, asOf)
			sb.WriteString(fmt.Sprintf("- %s (%s): balance=$%.2f  APR=%.2f%%  min_payment=$%.2f/mo  months_remaining=%d",
				l.Name, l.Lender, balance, apr, l.MinimumPayment, monthsLeft))
			if l.Notes != "" {
				sb.WriteString(fmt.Sprintf("  notes=%q", l.Notes))
			}
			sb.WriteString("\n")
		}
		sb.WriteString("\n")
	}

	// Summarize cash flow from transactions (last 30 days of external transactions)
	var totalIncome, totalSpend float64
	recurringByDesc := map[string]float64{}
	categorySpend := map[string]float64{}
	uncategorized := []db.Transaction{}
	for _, tx := range txns {
		if tx.IsInternal {
			continue
		}
		if tx.Direction == "credit" {
			totalIncome += tx.Amount
		} else {
			totalSpend += tx.Amount
			if tx.IsRecurring {
				recurringByDesc[tx.Description] += tx.Amount
			}
			cat := tx.Category
			if cat == "" {
				cat = "Uncategorized"
				uncategorized = append(uncategorized, tx)
			}
			categorySpend[cat] += tx.Amount
		}
	}

	sb.WriteString("## Recent cash flow (last 30 days, external transactions only)\n\n")
	sb.WriteString(fmt.Sprintf("- Total income: $%.2f\n", totalIncome))
	sb.WriteString(fmt.Sprintf("- Total spend: $%.2f\n", totalSpend))
	sb.WriteString(fmt.Sprintf("- Net: $%.2f\n\n", totalIncome-totalSpend))

	if len(categorySpend) > 0 {
		sb.WriteString("## Spend by category (last 30 days, debits only)\n\n")
		// Sort by amount descending for readability
		type catAmt struct{ cat string; amt float64 }
		var cats []catAmt
		for c, a := range categorySpend {
			cats = append(cats, catAmt{c, a})
		}
		for i := 0; i < len(cats); i++ {
			for j := i + 1; j < len(cats); j++ {
				if cats[j].amt > cats[i].amt {
					cats[i], cats[j] = cats[j], cats[i]
				}
			}
		}
		for _, ca := range cats {
			sb.WriteString(fmt.Sprintf("- %-30s $%.2f\n", ca.cat, ca.amt))
		}
		sb.WriteString("\n")
	}

	// Collect annotated and recurring before writing sections
	var annotated []db.Transaction
	for _, tx := range txns {
		if !tx.IsInternal && tx.Notes != "" {
			annotated = append(annotated, tx)
		}
	}

	if len(annotated) > 0 {
		sb.WriteString("## User-annotated transactions (read these first — they explain specific line items)\n\n")
		for _, tx := range annotated {
			sign := "-"
			if tx.Direction == "credit" {
				sign = "+"
			}
			cat := tx.Category
			if cat == "" {
				cat = "uncategorized"
			}
			sb.WriteString(fmt.Sprintf("- %s  %s$%.2f  %-30s  [%s]  NOTE: %s\n",
				tx.Date.Format("2006-01-02"),
				sign,
				tx.Amount,
				tx.Description,
				cat,
				tx.Notes,
			))
		}
		sb.WriteString("\n")
	}

	if len(recurringByDesc) > 0 {
		sb.WriteString("## Recurring obligations identified in transactions\n\n")
		for desc, amt := range recurringByDesc {
			sb.WriteString(fmt.Sprintf("- %s: $%.2f\n", desc, amt))
		}
		sb.WriteString("\n")
	}

	if len(uncategorized) > 0 {
		sb.WriteString("## Uncategorized transactions (inspect for hidden spending patterns)\n\n")
		for _, tx := range uncategorized {
			line := fmt.Sprintf("- %s  -$%.2f  %s", tx.Date.Format("2006-01-02"), tx.Amount, tx.Description)
			if tx.Notes != "" {
				line += fmt.Sprintf("  [note: %s]", tx.Notes)
			}
			sb.WriteString(line + "\n")
		}
		sb.WriteString("\n")
	}

	if userContext != "" {
		sb.WriteString("## Personal financial context\n\n")
		sb.WriteString(userContext)
		sb.WriteString("\n\n")
	}

	sb.WriteString("Given this snapshot, use the personal financial context above to determine the discretionary pool — do NOT compute it from gross transaction income. The transactions show multiple payroll deposits split across accounts by design; the true discretionary amount is the residual deposited to SoFi Checking after all loan allocations, which the personal financial context states is approximately $500–$800 per pay period (biweekly). Use $500/month as the conservative floor for the paydown strategy. Be specific about amounts and timelines.")
	return sb.String()
}

func parseResponse(raw string) (Strategy, error) {
	raw = strings.TrimSpace(raw)
	if strings.HasPrefix(raw, "```") {
		raw = strings.TrimPrefix(raw, "```json")
		raw = strings.TrimPrefix(raw, "```")
		if idx := strings.LastIndex(raw, "```"); idx >= 0 {
			raw = raw[:idx]
		}
		raw = strings.TrimSpace(raw)
	}

	var s Strategy
	if err := json.Unmarshal([]byte(raw), &s); err != nil {
		return Strategy{}, fmt.Errorf("parse paydown response: %w\nraw: %s", err, raw)
	}
	return s, nil
}

func monthsBetween(start, end time.Time) int {
	years := end.Year() - start.Year()
	months := int(end.Month()) - int(start.Month())
	total := years*12 + months
	if end.Day() < start.Day() {
		total--
	}
	return total
}
