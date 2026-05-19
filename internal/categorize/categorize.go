package categorize

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/anthropics/anthropic-sdk-go"
	"github.com/anthropics/anthropic-sdk-go/option"
	"github.com/rorakhit/frank/internal/db"
)

const model = "claude-sonnet-4-6"

// AutoCategorizeResult is what comes back from a suggestion run.
type AutoCategorizeResult struct {
	Assignments []db.CategorizationSuggestion
	Rules       []db.CategorizationSuggestion
}

const batchSize = 30 // transactions per Claude call to avoid token limits

// Suggest calls Claude with uncategorized transactions + existing rules and returns
// per-transaction assignments and proposed new rules. Nothing is written to the DB here.
// Large transaction sets are processed in batches.
func Suggest(ctx context.Context, apiKey string, txns []db.Transaction, rules []db.CategorizationRule) (AutoCategorizeResult, error) {
	if len(txns) == 0 {
		return AutoCategorizeResult{}, nil
	}

	c := anthropic.NewClient(option.WithAPIKey(apiKey))
	var combined AutoCategorizeResult

	for i := 0; i < len(txns); i += batchSize {
		end := i + batchSize
		if end > len(txns) {
			end = len(txns)
		}
		batch := txns[i:end]

		prompt := buildPrompt(batch, rules)
		msg, err := c.Messages.New(ctx, anthropic.MessageNewParams{
			Model:     anthropic.Model(model),
			MaxTokens: 8192,
			System: []anthropic.TextBlockParam{
				{Text: systemPrompt},
			},
			Messages: []anthropic.MessageParam{
				anthropic.NewUserMessage(anthropic.NewTextBlock(prompt)),
			},
		})
		if err != nil {
			return AutoCategorizeResult{}, fmt.Errorf("claude api (batch %d): %w", i/batchSize, err)
		}

		var raw string
		for _, block := range msg.Content {
			if block.Type == "text" {
				raw = block.Text
				break
			}
		}

		result, err := parseResponse(raw)
		if err != nil {
			return AutoCategorizeResult{}, fmt.Errorf("parse response (batch %d): %w", i/batchSize, err)
		}
		combined.Assignments = append(combined.Assignments, result.Assignments...)
		combined.Rules = append(combined.Rules, result.Rules...)
	}

	return combined, nil
}

// --- prompt construction ---

const systemPrompt = `You are a personal finance transaction categorizer. Given a list of bank transactions and existing categorization rules, you will:
1. Assign a category, recurring flag, cadence, and internal-transfer flag to each transaction
2. Propose reusable rules (pattern-based) that would generalize across multiple similar transactions

Respond with valid JSON in exactly this structure:
{
  "assignments": [
    {
      "description": "<exact description from input>",
      "category": "<category string>",
      "is_recurring": <true|false>,
      "cadence": "<weekly|biweekly|monthly|quarterly|yearly or empty string>",
      "is_internal": <true|false>,
      "confidence": <0-100>,
      "notes": "<brief reasoning, 1 sentence max>"
    }
  ],
  "suggested_rules": [
    {
      "pattern": "<case-insensitive substring that would match similar transactions>",
      "category": "<category string>",
      "is_recurring": <true|false>,
      "cadence": "<cadence or empty string>",
      "is_internal": <true|false>,
      "notes": "<why this rule generalizes>"
    }
  ]
}

Category taxonomy (use these or a close variant — don't invent exotic categories):
Food and Drink, Groceries, Shopping, Entertainment, Travel, Healthcare, Bills and Utilities,
Subscriptions, Insurance, Transfers, Income, Payroll, Investment, Internal Transfer, Loan Payment, Uncategorized

Rules for is_internal: true only for vault movements, savings-to-checking shuffles, credit card payments from own accounts, or roundup transfers. NOT for external payments like loan payments to other institutions.

Only propose a suggested_rule when the same pattern would match 2+ transactions — don't propose rules for one-off merchants.

confidence: your certainty that the category/flags are correct (0-100).`

func buildPrompt(txns []db.Transaction, rules []db.CategorizationRule) string {
	var sb strings.Builder

	if len(rules) > 0 {
		sb.WriteString("## Existing rules (already applied — do not re-suggest these patterns)\n\n")
		for _, r := range rules {
			sb.WriteString(fmt.Sprintf("- pattern=%q  category=%q  is_recurring=%v  is_internal=%v\n",
				r.Pattern, r.Category, r.IsRecurring, r.IsInternal))
		}
		sb.WriteString("\n")
	}

	sb.WriteString("## Transactions to categorize\n\n")
	for _, tx := range txns {
		sb.WriteString(fmt.Sprintf("- description=%q  amount=%.2f  direction=%s\n",
			tx.Description, tx.Amount, tx.Direction))
	}

	return sb.String()
}

// --- response parsing ---

type responseJSON struct {
	Assignments    []assignmentJSON    `json:"assignments"`
	SuggestedRules []suggestedRuleJSON `json:"suggested_rules"`
}

type assignmentJSON struct {
	Description string  `json:"description"`
	Category    string  `json:"category"`
	IsRecurring bool    `json:"is_recurring"`
	Cadence     string  `json:"cadence"`
	IsInternal  bool    `json:"is_internal"`
	Confidence  int     `json:"confidence"`
	Notes       string  `json:"notes"`
}

type suggestedRuleJSON struct {
	Pattern     string `json:"pattern"`
	Category    string `json:"category"`
	IsRecurring bool   `json:"is_recurring"`
	Cadence     string `json:"cadence"`
	IsInternal  bool   `json:"is_internal"`
	Notes       string `json:"notes"`
}

func parseResponse(raw string) (AutoCategorizeResult, error) {
	raw = strings.TrimSpace(raw)
	if strings.HasPrefix(raw, "```") {
		raw = strings.TrimPrefix(raw, "```json")
		raw = strings.TrimPrefix(raw, "```")
		if idx := strings.LastIndex(raw, "```"); idx >= 0 {
			raw = raw[:idx]
		}
		raw = strings.TrimSpace(raw)
	}

	var parsed responseJSON
	if err := json.Unmarshal([]byte(raw), &parsed); err != nil {
		return AutoCategorizeResult{}, fmt.Errorf("parse categorize response: %w\nraw: %s", err, raw)
	}

	var result AutoCategorizeResult

	for _, a := range parsed.Assignments {
		desc := a.Description
		result.Assignments = append(result.Assignments, db.CategorizationSuggestion{
			SuggestionType:         "transaction",
			TransactionDescription: &desc,
			Category:               a.Category,
			IsRecurring:            a.IsRecurring,
			Cadence:                a.Cadence,
			IsInternal:             a.IsInternal,
			Confidence:             a.Confidence,
			Notes:                  a.Notes,
		})
	}

	for _, r := range parsed.SuggestedRules {
		pat := r.Pattern
		result.Rules = append(result.Rules, db.CategorizationSuggestion{
			SuggestionType: "rule",
			Pattern:        &pat,
			Category:       r.Category,
			IsRecurring:    r.IsRecurring,
			Cadence:        r.Cadence,
			IsInternal:     r.IsInternal,
			Confidence:     0,
			Notes:          r.Notes,
		})
	}

	return result, nil
}
