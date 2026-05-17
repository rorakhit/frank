package insights

import "github.com/rorakhit/frank/internal/db"

// BuildGoalContexts computes progress for structured goals from period transactions.
// Free-text goals pass through with nil CurrentValue.
func BuildGoalContexts(goals []db.Goal, p PeriodSummary) []GoalContext {
	if len(goals) == 0 {
		return nil
	}

	// Compute period totals needed for savings_rate and spending_cap goals.
	var totalIncome, totalSpend float64
	categorySpend := map[string]float64{}
	for _, tx := range p.Transactions {
		if tx.IsIncome || tx.Direction == "credit" {
			totalIncome += tx.Amount
		} else {
			totalSpend += tx.Amount
			if tx.Category != "" {
				categorySpend[tx.Category] += tx.Amount
			}
		}
	}

	out := make([]GoalContext, 0, len(goals))
	for _, g := range goals {
		gc := GoalContext{
			Description: g.Description,
			Type:        g.Type,
			Horizon:     g.Horizon,
			TargetValue: g.TargetValue,
			Category:    g.Category,
		}

		switch g.Type {
		case "savings_rate":
			gc.Unit = "%"
			if totalIncome > 0 {
				rate := (totalIncome - totalSpend) / totalIncome * 100
				gc.CurrentValue = &rate
			}
		case "spending_cap":
			gc.Unit = "$"
			var current float64
			if g.Category != "" {
				current = categorySpend[g.Category]
			} else {
				current = totalSpend
			}
			gc.CurrentValue = &current
		case "free_text":
			// No computed progress — Claude interprets from the transaction data.
		}

		out = append(out, gc)
	}
	return out
}
