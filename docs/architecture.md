# Architecture — frank

## System Overview

frank is a Go backend monolith organized around a layered dependency graph: the database layer is the foundation, internal packages build on it, and CLI commands (and eventually an HTTP server) sit at the top.

```
┌────────────────────────────────────────────────────────────┐
│                    cmd/insights (CLI)                       │
│  --period  --days  --model  --thinking-budget  --dry-run   │
└──────────────────────┬─────────────────────────────────────┘
                       │
          ┌────────────▼────────────┐
          │   internal/insights      │
          │  ┌──────────────────┐   │
          │  │  Analyzer iface  │   │  ← swappable LLM backend
          │  │  ClaudeAnalyzer  │   │  ← anthropic-sdk-go
          │  │  Generate()      │   │  ← assembles request, parses response
          │  │  BuildPrompts()  │   │  ← constructs system + user prompts
          │  └──────────────────┘   │
          └────────────┬────────────┘
                       │
     ┌─────────────────▼───────────────────┐
     │              internal/evals          │
     │   Record, Input, Output, Append()   │  ← JSONL eval store
     └─────────────────────────────────────┘
                       │
     ┌─────────────────▼───────────────────┐
     │               internal/db            │
     │   Connect(), FetchTransactions(),   │
     │   InsertInsight()                   │
     └─────────────────┬───────────────────┘
                       │
     ┌─────────────────▼───────────────────┐
     │             PostgreSQL               │
     │   14 tables, 6 migrations           │
     └─────────────────────────────────────┘
```

---

## Package Responsibilities

### `internal/db`

**`db.go`** — `Connect(ctx, dsn) (*pgxpool.Pool, error)`. Opens a pgx connection pool and pings it. Single entry point for all DB connections.

**`queries.go`** — Hand-written queries (not sqlc). Two exported functions:
- `FetchTransactions(ctx, pool, start, end) ([]Transaction, error)` — returns posted (non-pending) transactions in date range, ordered by date DESC. Prefers `description_normal` over raw `description`.
- `InsertInsight(ctx, pool, Insight) error` — inserts an AI-generated insight row.

**`migrations/`** — 6 numbered up/down SQL pairs, applied via the `golang-migrate` CLI:
```
migrate -path internal/db/migrations \
        -database "postgresql://frank:frank@localhost:5432/frank?sslmode=disable" up
```

### `internal/insights`

The AI analysis pipeline. Three key abstractions:

**`analyzer.go`** — The `Analyzer` interface:
```go
type Analyzer interface {
    Analyze(ctx context.Context, req AnalysisRequest) (AnalysisResult, error)
}
```
`AnalysisRequest` carries the system prompt, user prompt, model, token budget, temperature, and thinking budget. `AnalysisResult` carries the text response, thinking text, stop reason, and all token counts. This interface makes the LLM a swappable dependency — Claude today, a local model later.

**`claude.go`** — `ClaudeAnalyzer`, the official Anthropic SDK implementation:
- Constructed with `NewClaudeAnalyzer(apiKey string)`
- Sets `anthropic-beta: prompt-caching-2024-07-31` header on all requests
- Attaches `cache_control: ephemeral` to the system block
- Enables extended thinking via `ThinkingConfigParamOfEnabled(budget)` when `ThinkingBudget > 0`
- Extracts `thinking` and `text` content blocks from the response union type

**`generator.go`** — `Generate(ctx, analyzer, cfg, period) (Result, evals.Record, error)`:
- Calls `BuildPrompts(period)` to construct the system and user prompts
- Calls `analyzer.Analyze(ctx, req)`
- Calls `ParseInsightResponse(text)` to extract JSON from the response (handles markdown fences)
- Assembles and returns an `evals.Record` with full input/output provenance
- Defaults: empty `Config{}` is filled with `DefaultModel`, `DefaultMaxTokens`, `DefaultTemperature`

**`prompt.go`** — `BuildPrompts(PeriodSummary, userContext string) (system, user string)`:
- System prompt: instructs Claude as a personal finance analyst for Affinity FCU / SoFi / Chase; mandates JSON output with `raw_analysis` and `key_findings` fields
- If `userContext` is non-empty (loaded from `context.md` at project root), it is appended to the system prompt under a "## User Context" heading. This file is gitignored — see `context.md.example` for the template
- User prompt: period header, transaction totals (spend/income/net), spend by category, recurring charges section, full transaction table

### `internal/evals`

Eval record types and JSONL writer. Designed so that every Claude call is fully replayable and comparable across models.

**`store.go`** — Key types:
- `Input` — system prompt, user prompt, temperature, max tokens, thinking budget
- `Output` — raw analysis, key findings, thinking text, stop reason, all four token counts
- `Record` — UUID, timestamp, model, period metadata, `Input`, `Output`, score (nil), notes
- `NewRecord(...)` — constructs a record with a fresh UUID and UTC timestamp
- `Append(record, runFile)` — creates directories if needed, appends one JSON line
- `RunFile(dataDir, runAt)` — returns `data/evals/20260517_143000_insights.jsonl`

### `internal/testdb`

Integration test helper. `New(t *testing.T) *pgxpool.Pool`:
- Connects to the local Docker Postgres (`postgresql://frank:frank@localhost:5432`)
- Creates `frank_test_<random>` database
- Runs all `*.up.sql` migrations in order
- Registers `t.Cleanup` to drop the database
- Skips (not fails) if Postgres is unreachable

### `cmd/insights`

CLI entry point. Flags:
| Flag | Default | Description |
|---|---|---|
| `--period` | `biweekly` | `biweekly` \| `monthly` \| `yearly` |
| `--days` | 0 (auto) | Override lookback window in days |
| `--model` | `claude-sonnet-4-6` | Any Anthropic model ID |
| `--thinking-budget` | 5000 | Extended thinking token budget (0 = disabled) |
| `--dry-run` | false | Print prompts, skip API call and DB write |

Flow: validate flags → connect DB → compute date range → fetch transactions → build `PeriodSummary` → (dry-run: print prompts and exit) → construct `ClaudeAnalyzer` → call `Generate` → `InsertInsight` → `evals.Append` → print results.

---

## Database Schema

14 tables across 6 migrations:

| Migration | Tables |
|---|---|
| 001_core | `institutions`, `accounts` |
| 002_transactions | `recurring_merchants`, `transactions` |
| 003_financial_metadata | `balance_snapshots`, `credit_accounts`, `loan_accounts` |
| 004_categorization | `categorization_rules`, `custom_categories` |
| 005_paycheck_and_reports | `paycheck_patterns`, `savings_goals`, `savings_events`, `insights` |
| 006_scrape_runs | `scrape_runs` |

**Key relationships:**
- `accounts` → `institutions` (FK)
- `transactions` → `accounts` (FK, cascade delete)
- `balance_snapshots`, `credit_accounts`, `loan_accounts` → `accounts` (FK)
- `scrape_runs` → `institutions` (FK)

**Notable constraints:**
- `transactions.direction` CHECK IN ('debit', 'credit')
- `insights.period_type` CHECK IN ('biweekly', 'monthly', 'yearly')
- `savings_events.period_end` UNIQUE (dedup gate for paycheck reports)
- `accounts` UNIQUE on (institution_id, source_account_id)

---

## AI Pipeline Design

### Prompt Caching

The system prompt is tagged with `cache_control: ephemeral` and the `prompt-caching-2024-07-31` beta header is set on every request. When the system prompt is unchanged across calls (e.g. repeated runs for the same period type), Anthropic serves it from cache, saving input token costs. Cache creation and cache read tokens are both captured in the eval record.

### Extended Thinking

When `ThinkingBudget > 0` (default 5000 tokens), `ClaudeAnalyzer` enables extended thinking. The thinking text is a separate content block in the response, extracted into `AnalysisResult.ThinkingText` and stored in the eval record under `Output.ThinkingText`. Minimum effective budget is 1024 tokens.

### Eval Pipeline

Every non-dry-run call writes a JSONL record to `data/evals/<timestamp>_insights.jsonl`. The record contains:
- Full system and user prompts (for replay)
- Model, temperature, token budget
- Complete output: raw analysis, key findings, thinking text
- Token usage breakdown (input, output, cache creation, cache read)
- Stop reason
- UUID + timestamp

This enables model comparison: run the same period with `claude-sonnet-4-6` and a local Qwen model, compare eval records side by side.

### `Analyzer` Interface

```go
type Analyzer interface {
    Analyze(ctx context.Context, req AnalysisRequest) (AnalysisResult, error)
}
```

The interface boundary means:
- `Generate` has no import of the Anthropic SDK — only `internal/insights` internals
- Tests use `stubAnalyzer` — no real API calls, no network
- A future `OllamaAnalyzer` is a drop-in: implement `Analyze`, pass to `Generate`

---

## Testing Architecture

Two tiers:

**Tier 1 — Unit tests** (`go test ./...`, always run):
- `internal/insights`: `ParseInsightResponse` (7 cases), `BuildPrompts` (15 cases), `Generate` with `stubAnalyzer` (6 cases)
- `internal/evals`: `NewRecord`, `Append`, `RunFile` (6 cases)

**Tier 2 — Integration tests** (same `go test ./...`, skip when Postgres unreachable):
- `internal/db`: `FetchTransactions` (5 cases), `InsertInsight` (3 cases)
- Each test gets a fresh throwaway database via `internal/testdb.New(t)`

The post-edit hook (`.git/hooks` + `.claude/settings.json`) runs `go test ./...` automatically after every `.go` file save.

---

## Development Environment

**Prerequisites:**
- Go 1.26+
- Docker (for local Postgres)
- `golang-migrate` CLI: `brew install golang-migrate`

**Local Postgres:**
```bash
docker run -d --name frank-postgres \
  -e POSTGRES_USER=frank \
  -e POSTGRES_PASSWORD=frank \
  -e POSTGRES_DB=frank \
  -p 5432:5432 postgres:16
```

**Run migrations:**
```bash
migrate -path internal/db/migrations \
        -database "postgresql://frank:frank@localhost:5432/frank?sslmode=disable" up
```

**Build:**
```bash
go build ./...
```

**Test:**
```bash
go test ./...
```

**Run insights CLI (dry run):**
```bash
DATABASE_URL="postgresql://frank:frank@localhost:5432/frank?sslmode=disable" \
go run ./cmd/insights --period biweekly --dry-run
```

**Run insights CLI (full):**
```bash
DATABASE_URL="..." ANTHROPIC_API_KEY="..." \
go run ./cmd/insights --period biweekly --thinking-budget 5000
```
