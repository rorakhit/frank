package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"runtime"
	"time"

	"github.com/rorakhit/frank/internal/db"
	"github.com/rorakhit/frank/internal/evals"
	"github.com/rorakhit/frank/internal/insights"
)

func main() {
	period := flag.String("period", "biweekly", "Period type: biweekly | monthly | yearly")
	days := flag.Int("days", 0, "Lookback window in days (overrides period default)")
	model := flag.String("model", insights.DefaultModel, "Claude model ID")
	thinkingBudget := flag.Int("thinking-budget", insights.DefaultThinkingBudget, "Extended thinking token budget (0 to disable)")
	dryRun := flag.Bool("dry-run", false, "Print prompt only, skip API call and DB write")
	flag.Parse()

	// Validate period
	switch *period {
	case "biweekly", "monthly", "yearly":
	default:
		log.Fatalf("invalid --period %q: must be biweekly, monthly, or yearly", *period)
	}

	// Resolve lookback window
	lookback := *days
	if lookback == 0 {
		switch *period {
		case "biweekly":
			lookback = 14
		case "monthly":
			lookback = 30
		case "yearly":
			lookback = 365
		}
	}

	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		log.Fatal("DATABASE_URL not set")
	}
	apiKey := os.Getenv("ANTHROPIC_API_KEY")
	if apiKey == "" && !*dryRun {
		log.Fatal("ANTHROPIC_API_KEY not set")
	}

	ctx := context.Background()

	pool, err := db.Connect(ctx, dsn)
	if err != nil {
		log.Fatalf("db: %v", err)
	}
	defer pool.Close()

	end := time.Now()
	start := end.AddDate(0, 0, -lookback)

	fmt.Printf("Fetching transactions %s → %s (%s, %d days)...\n",
		start.Format("2006-01-02"), end.Format("2006-01-02"), *period, lookback)

	txns, err := db.FetchTransactions(ctx, pool, start, end)
	if err != nil {
		log.Fatalf("fetch transactions: %v", err)
	}
	fmt.Printf("Found %d transactions.\n\n", len(txns))

	p := insights.PeriodSummary{
		PeriodType:   *period,
		Start:        start,
		End:          end,
		Transactions: txns,
	}

	if *period == "yearly" {
		loans, err := db.ListLoans(ctx, pool)
		if err != nil {
			log.Fatalf("list loans: %v", err)
		}
		credits, err := db.ListCreditAccounts(ctx, pool)
		if err != nil {
			log.Fatalf("list credit accounts: %v", err)
		}
		p.Loans = loans
		p.CreditAccounts = credits
	}

	goals, err := db.FetchActiveGoals(ctx, pool)
	if err != nil {
		log.Fatalf("fetch goals: %v", err)
	}
	p.Goals = insights.BuildGoalContexts(goals, p)

	if *dryRun {
		sys, user := insights.BuildPrompts(p, "")
		fmt.Println("=== SYSTEM PROMPT ===")
		fmt.Println(sys)
		fmt.Println("\n=== USER PROMPT ===")
		fmt.Println(user)
		return
	}

	cfg := insights.Config{
		APIKey:         apiKey,
		Model:          *model,
		MaxTokens:      insights.DefaultMaxTokens,
		Temperature:    insights.DefaultTemperature,
		ThinkingBudget: *thinkingBudget,
	}

	analyzer := insights.NewClaudeAnalyzer(apiKey)

	fmt.Printf("Calling %s...\n", cfg.Model)
	result, evalRecord, err := insights.Generate(ctx, analyzer, cfg, p)
	if err != nil {
		log.Fatalf("generate: %v", err)
	}

	// Write insight to DB
	ins := db.Insight{
		PeriodStart:  start,
		PeriodEnd:    end,
		PeriodType:   *period,
		RawAnalysis:  result.RawAnalysis,
		KeyFindings:  result.KeyFindings,
		ThinkingText: result.ThinkingText,
		Model:        cfg.Model,
		InputTokens:  result.InputTokens,
		OutputTokens: result.OutputTokens,
	}
	if err := db.InsertInsight(ctx, pool, ins); err != nil {
		log.Fatalf("insert insight: %v", err)
	}
	fmt.Println("Insight written to DB.")

	// Write eval record
	runAt := evalRecord.RanAt
	dataDir := dataDirectory()
	runFile := evals.RunFile(dataDir, runAt)
	if err := evals.Append(evalRecord, runFile); err != nil {
		log.Fatalf("write eval: %v", err)
	}
	fmt.Printf("Eval record written to %s\n", runFile)

	// Print summary
	fmt.Println("\n=== ANALYSIS ===")
	fmt.Println(result.RawAnalysis)
	fmt.Println("\n=== KEY FINDINGS ===")
	for i, f := range result.KeyFindings {
		fmt.Printf("%d. %s\n", i+1, f)
	}
}

// dataDirectory returns the project-root/data directory, resolved relative to this binary's source.
func dataDirectory() string {
	_, filename, _, ok := runtime.Caller(0)
	if !ok {
		return "data"
	}
	// filename is .../cmd/insights/main.go — go up 3 levels to project root
	root := filepath.Join(filepath.Dir(filename), "..", "..")
	return filepath.Join(root, "data")
}
