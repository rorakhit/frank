package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/rorakhit/frank/internal/categorize"
	"github.com/rorakhit/frank/internal/db"
	"github.com/rorakhit/frank/internal/insights"
	"github.com/rorakhit/frank/internal/paydown"
)

func main() {
	port := flag.String("port", "8080", "HTTP listen port")
	flag.Parse()

	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		log.Fatal("DATABASE_URL not set")
	}
	apiKey := os.Getenv("ANTHROPIC_API_KEY")

	ctx := context.Background()
	pool, err := db.Connect(ctx, dsn)
	if err != nil {
		log.Fatalf("db: %v", err)
	}
	defer pool.Close()

	r := chi.NewRouter()
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(middleware.CleanPath)
	r.Use(corsMiddleware)

	r.Get("/health", handleHealth())
	r.Route("/api", func(r chi.Router) {
		r.Get("/institutions", handleListInstitutions(pool))
		r.Get("/accounts", handleListAccounts(pool))
		r.Get("/transactions", handleListTransactions(pool))
		r.Patch("/transactions/{id}/notes", handleSetTransactionNote(pool))
		r.Get("/loans", handleListLoans(pool))
		r.Get("/credit-accounts", handleListCreditAccounts(pool))

		r.Get("/insights", handleListInsights(pool))
		r.Post("/insights/generate", handleGenerateInsight(pool, apiKey))

		r.Get("/goals", handleListGoals(pool))
		r.Post("/goals", handleCreateGoal(pool))
		r.Patch("/goals/{id}", handleUpdateGoal(pool))
		r.Delete("/goals/{id}", handleDeactivateGoal(pool))

		r.Get("/categorization-rules", handleListCategorizationRules(pool))
		r.Post("/categorization-rules", handleCreateCategorizationRule(pool))
		r.Put("/categorization-rules/{id}", handleUpdateCategorizationRule(pool))
		r.Delete("/categorization-rules/{id}", handleDeleteCategorizationRule(pool))
		r.Post("/categorization-rules/apply", handleApplyCategorizationRules(pool))

		r.Get("/debt/coach", handleGetDebtCoach(pool))
		r.Post("/debt/coach", handleDebtCoach(pool, apiKey))

		r.Post("/categorize/suggest", handleCategorizeSuggest(pool, apiKey))
		r.Get("/categorize/suggestions", handleListSuggestions(pool))
		r.Post("/categorize/suggestions/{id}/approve", handleApproveSuggestion(pool))
		r.Post("/categorize/suggestions/{id}/dismiss", handleDismissSuggestion(pool))
	})

	log.Printf("frank server listening on :%s", *port)
	if err := http.ListenAndServe(":"+*port, r); err != nil {
		log.Fatalf("server: %v", err)
	}
}

// corsMiddleware allows requests from the Vite dev server and local frontends.
func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "http://localhost:5173")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func handleHealth() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	}
}

func handleListInstitutions(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		institutions, err := db.ListInstitutions(r.Context(), pool)
		if err != nil {
			log.Printf("list institutions: %v", err)
			writeJSON(w, http.StatusInternalServerError, errBody("internal error"))
			return
		}
		writeJSON(w, http.StatusOK, institutions)
	}
}

func handleListAccounts(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		accounts, err := db.ListAccounts(r.Context(), pool)
		if err != nil {
			log.Printf("list accounts: %v", err)
			writeJSON(w, http.StatusInternalServerError, errBody("internal error"))
			return
		}
		writeJSON(w, http.StatusOK, accounts)
	}
}

func handleSetTransactionNote(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := chi.URLParam(r, "id")
		var body struct {
			Note string `json:"note"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeJSON(w, http.StatusBadRequest, errBody("invalid request body"))
			return
		}
		if err := db.SetTransactionNote(r.Context(), pool, id, body.Note); err != nil {
			log.Printf("set transaction note %q: %v", id, err)
			writeJSON(w, http.StatusInternalServerError, errBody("internal error"))
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func handleListTransactions(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		end := time.Now()
		start := end.AddDate(0, 0, -30)

		if s := q.Get("start"); s != "" {
			t, err := time.Parse("2006-01-02", s)
			if err != nil {
				writeJSON(w, http.StatusBadRequest, errBody("invalid start date, use YYYY-MM-DD"))
				return
			}
			start = t
		}
		if e := q.Get("end"); e != "" {
			t, err := time.Parse("2006-01-02", e)
			if err != nil {
				writeJSON(w, http.StatusBadRequest, errBody("invalid end date, use YYYY-MM-DD"))
				return
			}
			end = t
		}

		txns, err := db.FetchTransactions(r.Context(), pool, start, end)
		if err != nil {
			log.Printf("fetch transactions: %v", err)
			writeJSON(w, http.StatusInternalServerError, errBody("internal error"))
			return
		}
		writeJSON(w, http.StatusOK, txns)
	}
}

func handleListLoans(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		loans, err := db.ListLoans(r.Context(), pool)
		if err != nil {
			log.Printf("list loans: %v", err)
			writeJSON(w, http.StatusInternalServerError, errBody("internal error"))
			return
		}
		// Enrich with estimated current balance.
		type loanResponse struct {
			db.Loan
			EstimatedBalance float64 `json:"estimated_balance"`
		}
		now := time.Now()
		out := make([]loanResponse, len(loans))
		for i, l := range loans {
			out[i] = loanResponse{Loan: l, EstimatedBalance: db.EstimatedBalance(l, now)}
		}
		writeJSON(w, http.StatusOK, out)
	}
}

func handleListCreditAccounts(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		accounts, err := db.ListCreditAccounts(r.Context(), pool)
		if err != nil {
			log.Printf("list credit accounts: %v", err)
			writeJSON(w, http.StatusInternalServerError, errBody("internal error"))
			return
		}
		writeJSON(w, http.StatusOK, accounts)
	}
}

func handleListInsights(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ins, err := db.ListInsights(r.Context(), pool)
		if err != nil {
			log.Printf("list insights: %v", err)
			writeJSON(w, http.StatusInternalServerError, errBody("internal error"))
			return
		}
		writeJSON(w, http.StatusOK, ins)
	}
}

func handleGenerateInsight(pool *pgxpool.Pool, apiKey string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if apiKey == "" {
			writeJSON(w, http.StatusServiceUnavailable, errBody("ANTHROPIC_API_KEY not set"))
			return
		}

		var req struct {
			Period string `json:"period"` // "biweekly" | "monthly" | "yearly"
			Days   int    `json:"days"`   // 0 = use period default
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, errBody("invalid request body"))
			return
		}
		switch req.Period {
		case "biweekly", "monthly", "yearly":
		default:
			writeJSON(w, http.StatusBadRequest, errBody("period must be biweekly, monthly, or yearly"))
			return
		}

		lookback := req.Days
		if lookback == 0 {
			switch req.Period {
			case "biweekly":
				lookback = 14
			case "monthly":
				lookback = 30
			case "yearly":
				lookback = 365
			}
		}

		ctx := r.Context()
		end := time.Now()
		start := end.AddDate(0, 0, -lookback)

		txns, err := db.FetchTransactions(ctx, pool, start, end)
		if err != nil {
			log.Printf("generate insight — fetch transactions: %v", err)
			writeJSON(w, http.StatusInternalServerError, errBody("internal error"))
			return
		}

		p := insights.PeriodSummary{
			PeriodType:   req.Period,
			Start:        start,
			End:          end,
			Transactions: txns,
		}

		if req.Period == "yearly" {
			loans, _ := db.ListLoans(ctx, pool)
			credits, _ := db.ListCreditAccounts(ctx, pool)
			p.Loans = loans
			p.CreditAccounts = credits
		}

		goals, _ := db.FetchActiveGoals(ctx, pool)
		p.Goals = insights.BuildGoalContexts(goals, p)

		cfg := insights.Config{
			APIKey:         apiKey,
			Model:          insights.DefaultModel,
			MaxTokens:      insights.DefaultMaxTokens,
			Temperature:    insights.DefaultTemperature,
			ThinkingBudget: insights.DefaultThinkingBudget,
		}
		analyzer := insights.NewClaudeAnalyzer(apiKey)

		result, _, err := insights.Generate(ctx, analyzer, cfg, p)
		if err != nil {
			log.Printf("generate insight — claude: %v", err)
			writeJSON(w, http.StatusInternalServerError, errBody("insight generation failed"))
			return
		}

		ins := db.Insight{
			PeriodStart:  start,
			PeriodEnd:    end,
			PeriodType:   req.Period,
			RawAnalysis:  result.RawAnalysis,
			KeyFindings:  result.KeyFindings,
			ThinkingText: result.ThinkingText,
			Model:        cfg.Model,
			InputTokens:  result.InputTokens,
			OutputTokens: result.OutputTokens,
		}
		if err := db.InsertInsight(ctx, pool, ins); err != nil {
			log.Printf("generate insight — insert: %v", err)
			writeJSON(w, http.StatusInternalServerError, errBody("failed to save insight"))
			return
		}

		writeJSON(w, http.StatusOK, ins)
	}
}

func handleListGoals(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		goals, err := db.ListGoals(r.Context(), pool)
		if err != nil {
			log.Printf("list goals: %v", err)
			writeJSON(w, http.StatusInternalServerError, errBody("internal error"))
			return
		}
		writeJSON(w, http.StatusOK, goals)
	}
}

func handleCreateGoal(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var g db.Goal
		if err := json.NewDecoder(r.Body).Decode(&g); err != nil {
			writeJSON(w, http.StatusBadRequest, errBody("invalid request body"))
			return
		}
		switch g.Type {
		case "savings_rate", "spending_cap", "free_text":
		default:
			writeJSON(w, http.StatusBadRequest, errBody("type must be savings_rate, spending_cap, or free_text"))
			return
		}
		switch g.Horizon {
		case "monthly", "quarterly", "yearly":
		default:
			writeJSON(w, http.StatusBadRequest, errBody("horizon must be monthly, quarterly, or yearly"))
			return
		}
		if g.Description == "" {
			writeJSON(w, http.StatusBadRequest, errBody("description is required"))
			return
		}

		created, err := db.InsertGoal(r.Context(), pool, g)
		if err != nil {
			log.Printf("create goal: %v", err)
			writeJSON(w, http.StatusInternalServerError, errBody("internal error"))
			return
		}
		writeJSON(w, http.StatusCreated, created)
	}
}

func handleUpdateGoal(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := chi.URLParam(r, "id")
		var g db.Goal
		if err := json.NewDecoder(r.Body).Decode(&g); err != nil {
			writeJSON(w, http.StatusBadRequest, errBody("invalid request body"))
			return
		}
		updated, err := db.UpdateGoal(r.Context(), pool, id, g)
		if err != nil {
			log.Printf("update goal %q: %v", id, err)
			writeJSON(w, http.StatusInternalServerError, errBody("internal error"))
			return
		}
		writeJSON(w, http.StatusOK, updated)
	}
}

func handleDeactivateGoal(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := chi.URLParam(r, "id")
		if err := db.DeactivateGoal(r.Context(), pool, id); err != nil {
			log.Printf("deactivate goal %q: %v", id, err)
			writeJSON(w, http.StatusInternalServerError, errBody("internal error"))
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func handleCategorizeSuggest(pool *pgxpool.Pool, apiKey string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if apiKey == "" {
			writeJSON(w, http.StatusServiceUnavailable, errBody("ANTHROPIC_API_KEY not set"))
			return
		}
		ctx := r.Context()

		// Fetch uncategorized (or low-confidence) non-internal transactions from last 90 days
		end := time.Now()
		start := end.AddDate(0, 0, -90)
		all, err := db.FetchTransactions(ctx, pool, start, end)
		if err != nil {
			log.Printf("categorize suggest — fetch: %v", err)
			writeJSON(w, http.StatusInternalServerError, errBody("internal error"))
			return
		}
		var uncategorized []db.Transaction
		for _, tx := range all {
			if !tx.IsInternal && tx.Category == "" {
				uncategorized = append(uncategorized, tx)
			}
		}
		if len(uncategorized) == 0 {
			writeJSON(w, http.StatusOK, map[string]any{"assignments": []any{}, "rules": []any{}, "message": "all transactions already categorized"})
			return
		}

		rules, err := db.ListCategorizationRules(ctx, pool)
		if err != nil {
			log.Printf("categorize suggest — rules: %v", err)
			writeJSON(w, http.StatusInternalServerError, errBody("internal error"))
			return
		}

		result, err := categorize.Suggest(ctx, apiKey, uncategorized, rules)
		if err != nil {
			log.Printf("categorize suggest — claude: %v", err)
			writeJSON(w, http.StatusInternalServerError, errBody("suggestion generation failed"))
			return
		}

		// Clear previously reviewed suggestions, then insert new batch
		if err := db.ClearReviewedSuggestions(ctx, pool); err != nil {
			log.Printf("categorize suggest — clear: %v", err)
		}
		all_suggestions := append(result.Assignments, result.Rules...)
		if err := db.InsertSuggestions(ctx, pool, all_suggestions); err != nil {
			log.Printf("categorize suggest — insert: %v", err)
			writeJSON(w, http.StatusInternalServerError, errBody("failed to save suggestions"))
			return
		}

		writeJSON(w, http.StatusOK, map[string]any{
			"assignments": result.Assignments,
			"rules":       result.Rules,
		})
	}
}

func handleListSuggestions(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		suggestions, err := db.ListPendingSuggestions(r.Context(), pool)
		if err != nil {
			log.Printf("list suggestions: %v", err)
			writeJSON(w, http.StatusInternalServerError, errBody("internal error"))
			return
		}
		writeJSON(w, http.StatusOK, suggestions)
	}
}

func handleApproveSuggestion(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := chi.URLParam(r, "id")
		s, err := db.ApproveSuggestion(r.Context(), pool, id)
		if err != nil {
			log.Printf("approve suggestion %q: %v", id, err)
			writeJSON(w, http.StatusInternalServerError, errBody("internal error"))
			return
		}
		writeJSON(w, http.StatusOK, s)
	}
}

func handleDismissSuggestion(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := chi.URLParam(r, "id")
		if err := db.DismissSuggestion(r.Context(), pool, id); err != nil {
			log.Printf("dismiss suggestion %q: %v", id, err)
			writeJSON(w, http.StatusInternalServerError, errBody("internal error"))
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func handleGetDebtCoach(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		rec, err := db.LoadDebtCoach(r.Context(), pool)
		if err != nil {
			log.Printf("get debt coach: %v", err)
			writeJSON(w, http.StatusInternalServerError, errBody("internal error"))
			return
		}
		if rec == nil {
			writeJSON(w, http.StatusOK, nil)
			return
		}
		// Return the raw payload JSON directly, wrapped with generated_at
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		fmt.Fprintf(w, `{"generated_at":%q,"strategy":%s}`, rec.GeneratedAt.Format(time.RFC3339), rec.Payload)
	}
}

func handleDebtCoach(pool *pgxpool.Pool, apiKey string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if apiKey == "" {
			writeJSON(w, http.StatusServiceUnavailable, errBody("ANTHROPIC_API_KEY not set"))
			return
		}
		ctx := r.Context()

		loans, err := db.ListLoans(ctx, pool)
		if err != nil {
			log.Printf("debt coach — list loans: %v", err)
			writeJSON(w, http.StatusInternalServerError, errBody("internal error"))
			return
		}
		credits, err := db.ListCreditAccounts(ctx, pool)
		if err != nil {
			log.Printf("debt coach — list credits: %v", err)
			writeJSON(w, http.StatusInternalServerError, errBody("internal error"))
			return
		}

		end := time.Now()
		start := end.AddDate(0, 0, -30)
		txns, err := db.FetchTransactions(ctx, pool, start, end)
		if err != nil {
			log.Printf("debt coach — fetch transactions: %v", err)
			writeJSON(w, http.StatusInternalServerError, errBody("internal error"))
			return
		}

		userContext, _ := os.ReadFile("context.md")
		strategy, err := paydown.Generate(ctx, apiKey, loans, credits, txns, end, string(userContext))
		if err != nil {
			log.Printf("debt coach — generate: %v", err)
			writeJSON(w, http.StatusInternalServerError, errBody("strategy generation failed"))
			return
		}

		if _, err := db.SaveDebtCoach(ctx, pool, strategy); err != nil {
			log.Printf("debt coach — save: %v", err)
		}

		writeJSON(w, http.StatusOK, strategy)
	}
}

func handleListCategorizationRules(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		rules, err := db.ListCategorizationRules(r.Context(), pool)
		if err != nil {
			log.Printf("list categorization rules: %v", err)
			writeJSON(w, http.StatusInternalServerError, errBody("internal error"))
			return
		}
		writeJSON(w, http.StatusOK, rules)
	}
}

func handleCreateCategorizationRule(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var rule db.CategorizationRule
		if err := json.NewDecoder(r.Body).Decode(&rule); err != nil {
			writeJSON(w, http.StatusBadRequest, errBody("invalid request body"))
			return
		}
		if rule.Pattern == "" {
			writeJSON(w, http.StatusBadRequest, errBody("pattern is required"))
			return
		}
		created, err := db.UpsertCategorizationRule(r.Context(), pool, rule)
		if err != nil {
			log.Printf("create categorization rule: %v", err)
			writeJSON(w, http.StatusInternalServerError, errBody("internal error"))
			return
		}
		writeJSON(w, http.StatusCreated, created)
	}
}

func handleUpdateCategorizationRule(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := chi.URLParam(r, "id")
		var rule db.CategorizationRule
		if err := json.NewDecoder(r.Body).Decode(&rule); err != nil {
			writeJSON(w, http.StatusBadRequest, errBody("invalid request body"))
			return
		}
		updated, err := db.UpdateCategorizationRule(r.Context(), pool, id, rule)
		if err != nil {
			log.Printf("update categorization rule %q: %v", id, err)
			writeJSON(w, http.StatusInternalServerError, errBody("internal error"))
			return
		}
		writeJSON(w, http.StatusOK, updated)
	}
}

func handleDeleteCategorizationRule(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := chi.URLParam(r, "id")
		if err := db.DeleteCategorizationRule(r.Context(), pool, id); err != nil {
			log.Printf("delete categorization rule %q: %v", id, err)
			writeJSON(w, http.StatusInternalServerError, errBody("internal error"))
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func handleApplyCategorizationRules(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		n, err := db.ApplyCategorizationRules(r.Context(), pool)
		if err != nil {
			log.Printf("apply categorization rules: %v", err)
			writeJSON(w, http.StatusInternalServerError, errBody("internal error"))
			return
		}
		writeJSON(w, http.StatusOK, map[string]int64{"rows_updated": n})
	}
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		log.Printf("encode response: %v", err)
	}
}

func errBody(msg string) map[string]string {
	return map[string]string{"error": msg}
}
