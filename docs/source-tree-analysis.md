# Source Tree Analysis — frank

```
frank/
│
├── cmd/
│   ├── insights/
│   │   └── main.go          # CLI: --period, --days, --model, --thinking-budget, --dry-run
│   └── server/              # Placeholder — HTTP server not yet implemented
│
├── internal/
│   ├── db/
│   │   ├── db.go            # Connect() — pgxpool connection factory
│   │   ├── queries.go       # FetchTransactions(), InsertInsight(), Transaction/Insight types
│   │   ├── queries_test.go  # Integration tests (7 cases, uses testdb.New)
│   │   └── migrations/
│   │       ├── 001_core.{up,down}.sql              # institutions, accounts
│   │       ├── 002_transactions.{up,down}.sql      # recurring_merchants, transactions
│   │       ├── 003_financial_metadata.{up,down}.sql # balance_snapshots, credit_accounts, loan_accounts
│   │       ├── 004_categorization.{up,down}.sql    # categorization_rules, custom_categories
│   │       ├── 005_paycheck_and_reports.{up,down}.sql # paycheck_patterns, savings_goals, savings_events, insights
│   │       └── 006_scrape_runs.{up,down}.sql       # scrape_runs
│   │
│   ├── evals/
│   │   ├── store.go         # Record/Input/Output types, NewRecord(), Append(), RunFile()
│   │   └── store_test.go    # Unit tests (6 cases)
│   │
│   ├── insights/
│   │   ├── analyzer.go      # Analyzer interface, AnalysisRequest, AnalysisResult
│   │   ├── claude.go        # ClaudeAnalyzer — anthropic-sdk-go, prompt caching, extended thinking
│   │   ├── generator.go     # Generate(), ParseInsightResponse(), Config, Result, constants
│   │   ├── generator_test.go # Unit tests (11 cases: stubAnalyzer + ParseInsightResponse)
│   │   ├── prompt.go        # BuildPrompts(), PeriodSummary, truncate()
│   │   └── prompt_test.go   # Unit tests (15 cases)
│   │
│   ├── testdb/
│   │   └── testdb.go        # New(t) — throwaway Postgres DB per test, auto-cleanup
│   │
│   ├── alerts/              # Placeholder
│   ├── api/                 # Placeholder
│   ├── etl/                 # Placeholder
│   ├── reports/             # Placeholder
│   └── scraper/             # Placeholder
│
├── docs/                    # Project documentation
├── go.mod                   # github.com/rorakhit/frank, Go 1.26.1
├── go.sum
└── .gitignore               # Excludes: data/, scrapers/, _bmad/, .claude/, .firecrawl/
```

---

## Entry Points

| Path | Purpose |
|---|---|
| `cmd/insights/main.go` | `go run ./cmd/insights` — AI insights CLI |
| `cmd/server/` | Future HTTP server (placeholder) |

## Package Dependency Graph

```
cmd/insights
    └── internal/insights
            ├── internal/evals
            └── internal/db
```

## Test Coverage

| File | Type | Cases |
|---|---|---|
| `internal/db/queries_test.go` | Integration (skip if no Postgres) | 7 |
| `internal/evals/store_test.go` | Unit | 6 |
| `internal/insights/generator_test.go` | Unit | 11 |
| `internal/insights/prompt_test.go` | Unit | 15 |
