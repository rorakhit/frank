# API Contracts — frank

## Current State

frank has no HTTP server. `cmd/server/` is an empty placeholder. All user-facing interaction is via CLI commands and direct database access.

The contracts documented here are the **CLI interface** and the **internal package APIs** that future HTTP endpoints will wrap.

---

## CLI: `cmd/insights`

```
go run ./cmd/insights [flags]
```

### Flags

| Flag | Type | Default | Description |
|---|---|---|---|
| `--period` | string | `biweekly` | Lookback period: `biweekly` \| `monthly` \| `yearly` |
| `--days` | int | 0 (auto) | Override lookback window in days; 0 = use period default |
| `--model` | string | `claude-sonnet-4-6` | Any Anthropic model ID |
| `--thinking-budget` | int | 5000 | Extended thinking token budget; 0 = disabled; min 1024 when enabled |
| `--dry-run` | bool | false | Print system + user prompts, skip API call and DB write |

### Period defaults

| Period | Lookback |
|---|---|
| `biweekly` | 14 days |
| `monthly` | 30 days |
| `yearly` | 365 days |

### Environment variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL DSN, e.g. `postgresql://frank:frank@localhost:5432/frank?sslmode=disable` |
| `ANTHROPIC_API_KEY` | Yes (unless `--dry-run`) | Anthropic API key |

### Execution flow

1. Validate flags
2. Connect to Postgres via `internal/db.Connect`
3. Compute date range from `--period` / `--days`
4. Call `internal/db.FetchTransactions(ctx, pool, start, end)` — returns posted (non-pending) transactions in range
5. Build `PeriodSummary` from fetched transactions
6. If `--dry-run`: print system + user prompts and exit
7. Construct `insights.ClaudeAnalyzer` with `ANTHROPIC_API_KEY`
8. Call `insights.Generate(ctx, analyzer, cfg, periodSummary)` — returns `Result` and `evals.Record`
9. Call `internal/db.InsertInsight` to write the insight row
10. Call `evals.Append` to write the JSONL eval record to `data/evals/<timestamp>_insights.jsonl`
11. Print result summary to stdout

### Exit codes

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | Flag validation error, DB connection failure, API error, or DB write failure |

### Example invocations

```bash
# Dry run — no API call, no DB write
DATABASE_URL="postgresql://frank:frank@localhost:5432/frank?sslmode=disable" \
go run ./cmd/insights --period biweekly --dry-run

# Full run
DATABASE_URL="postgresql://..." ANTHROPIC_API_KEY="sk-ant-..." \
go run ./cmd/insights --period biweekly --thinking-budget 5000

# Monthly with local model (future: OllamaAnalyzer)
DATABASE_URL="..." go run ./cmd/insights --period monthly --model qwen2.5:32b
```

---

## Internal Package API: `internal/db`

### `Connect`

```go
func Connect(ctx context.Context, dsn string) (*pgxpool.Pool, error)
```

Opens a pgx connection pool and pings. Returns error if unreachable.

---

### `FetchTransactions`

```go
func FetchTransactions(ctx context.Context, pool *pgxpool.Pool, start, end time.Time) ([]Transaction, error)
```

Returns all posted (non-pending) transactions where `date BETWEEN start AND end`, ordered by `date DESC`. Prefers `description_normal` over `description` when both are present.

**`Transaction` type:**

```go
type Transaction struct {
    ID                  string
    Date                time.Time
    Amount              float64
    Direction           string  // "debit" | "credit"
    Description         string
    IsIncome            bool
    IsRecurring         bool
    Category            string
    CategoryConfidence  int
}
```

---

### `InsertInsight`

```go
func InsertInsight(ctx context.Context, pool *pgxpool.Pool, insight Insight) error
```

Inserts one row into the `insights` table.

**`Insight` type:**

```go
type Insight struct {
    PeriodStart  time.Time
    PeriodEnd    time.Time
    PeriodType   string    // "biweekly" | "monthly" | "yearly"
    RawAnalysis  string
    KeyFindings  []string
    Goals        string
}
```

---

## Internal Package API: `internal/insights`

### `Analyzer` interface

```go
type Analyzer interface {
    Analyze(ctx context.Context, req AnalysisRequest) (AnalysisResult, error)
}
```

Swappable LLM dependency. `ClaudeAnalyzer` is the production implementation; `stubAnalyzer` is used in tests.

---

### `AnalysisRequest`

```go
type AnalysisRequest struct {
    SystemPrompt   string
    UserPrompt     string
    Model          string
    MaxTokens      int
    Temperature    float64
    ThinkingBudget int  // 0 = disabled
}
```

---

### `AnalysisResult`

```go
type AnalysisResult struct {
    Text                     string
    ThinkingText             string
    StopReason               string
    InputTokens              int
    OutputTokens             int
    CacheCreationInputTokens int
    CacheReadInputTokens     int
}
```

---

### `Generate`

```go
func Generate(ctx context.Context, analyzer Analyzer, cfg Config, period PeriodSummary) (Result, evals.Record, error)
```

Orchestrates one insight generation cycle:
1. `BuildPrompts(period)` → system + user prompts
2. `analyzer.Analyze(ctx, req)`
3. `ParseInsightResponse(text)` → extracts JSON from response (handles markdown fences)
4. Assembles `evals.Record` with full input/output provenance

**`Config` type:**

```go
type Config struct {
    Model          string  // default: "claude-sonnet-4-6"
    MaxTokens      int     // default: 16000
    Temperature    float64 // default: 1.0
    ThinkingBudget int     // default: 5000
}
```

**`Result` type:**

```go
type Result struct {
    RawAnalysis string
    KeyFindings []string
    ThinkingText string
    StopReason   string
    InputTokens  int
    OutputTokens int
    CacheCreationInputTokens int
    CacheReadInputTokens     int
}
```

---

### `BuildPrompts`

```go
func BuildPrompts(period PeriodSummary) (system, user string)
```

Constructs the system prompt (persona, JSON output mandate) and user prompt (period header, transaction totals, category breakdown, recurring charges, full transaction table).

**`PeriodSummary` type:**

```go
type PeriodSummary struct {
    PeriodType   string
    Start        time.Time
    End          time.Time
    Transactions []db.Transaction
}
```

---

### `ParseInsightResponse`

```go
func ParseInsightResponse(text string) (rawAnalysis string, keyFindings []string, err error)
```

Extracts `raw_analysis` (string) and `key_findings` (array) from Claude's JSON response. Handles responses wrapped in markdown code fences (` ```json ... ``` `).

---

## Internal Package API: `internal/evals`

### `NewRecord`

```go
func NewRecord(model, periodType string, input Input, output Output) Record
```

Constructs a `Record` with a fresh UUID and UTC timestamp.

---

### `Append`

```go
func Append(record Record, runFile string) error
```

Creates parent directories if needed, then appends one JSON line to `runFile`.

---

### `RunFile`

```go
func RunFile(dataDir string, runAt time.Time) string
```

Returns `<dataDir>/evals/<YYYYMMDD>_<HHMMSS>_insights.jsonl`.

---

## Planned: HTTP Server (`cmd/server`)

The HTTP server is not yet implemented. When built, it will expose these capabilities as REST endpoints, with the internal package APIs as the backend. Authentication will be single-user (shared secret or session cookie) given the self-hosted, single-user nature of the project.

Expected endpoint surface (not yet implemented):

| Endpoint | Description |
|---|---|
| `POST /insights/generate` | Trigger an insights run for a period |
| `GET /insights` | List stored insights |
| `GET /transactions` | Query transactions by date range |
| `GET /accounts` | List accounts and institutions |
| `GET /sync/status` | Last scrape status per institution |
