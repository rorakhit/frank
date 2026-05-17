# frank

Self-hosted personal finance automation. Scrapes transactions directly from bank websites (Affinity FCU, SoFi, Chase), stores them in PostgreSQL, and uses Claude to generate AI-powered spending insights — no Plaid, no aggregator, no subscription cost.

This is a complete rewrite of [AutoBudget](#frank-vs-autobudget), the prior TypeScript/Plaid codebase. The central design decision: own the full data pipeline. Bank credentials and transaction data never leave the local machine.

---

## What It Does

- **Direct bank scraping** — Playwright (Python/asyncio) automates real browser sessions for Affinity FCU, SoFi, and Chase. No third-party aggregator in the loop.
- **AI spending insights** — Claude generates narrative analysis and key findings for any time window (biweekly, monthly, yearly). Extended thinking and prompt caching both supported.
- **Goal tracking** — Savings rate, spending cap, and free-text goals across monthly, quarterly, and yearly horizons. Active goals are injected into the prompt so every insight cycle includes progress commentary and improvement suggestions — designed to run against a locally hosted model.
- **LLM eval pipeline** — Every Claude call writes a full JSONL record (prompts, response, token counts, thinking text, stop reason). Designed for local model comparison.
- **Swappable LLM backend** — An `Analyzer` interface decouples the insights pipeline from Claude. Drop in an `OllamaAnalyzer` with no changes to the generator.
- **Postgres-native storage** — 14 tables across 6 migrations. Normalized schema with indexes, check constraints, and cascade rules.

frank is built to be AI-native from the ground up. The long-term goal is to run all insight and goal analysis against a locally hosted LLM — no API costs, no data leaving the machine. Claude is the current backend; the architecture is designed so swapping it out requires implementing a single Go interface.

---

## How It Works

```
Bank website
     │
     ▼
Playwright scraper (Python)
     │
     ▼
PostgreSQL (14 tables, 6 migrations)
     │
     ▼
go run ./cmd/insights --period biweekly
     │
     ├── FetchTransactions()
     │        │
     │        ▼
     │   BuildPrompts() → system + user prompt
     │        │
     │        ▼
     │   ClaudeAnalyzer.Analyze()
     │   (prompt caching + extended thinking)
     │        │
     │        ▼
     │   ParseInsightResponse() → raw_analysis + key_findings
     │        │
     ├── InsertInsight() → insights table
     │
     └── evals.Append() → data/evals/<timestamp>_insights.jsonl
```

---

## Stack

| Layer | Technology |
|---|---|
| Language | Go 1.26.1 |
| Database driver | `pgx/v5` (pgxpool) |
| LLM SDK | `anthropic-sdk-go v1.43.0` |
| Migrations | `golang-migrate` CLI |
| Scraping | Python 3 + Playwright (async, headed Chrome) |
| Credential management | 1Password CLI; TOTP seeds in `.env` |
| Testing | `go test` standard library; throwaway Postgres via `internal/testdb` |

---

## Quick Start

### Prerequisites

- Go 1.26+
- Docker (for local Postgres)
- `golang-migrate` CLI: `brew install golang-migrate`

### 1. Start Postgres

```bash
docker run -d --name frank-postgres \
  -e POSTGRES_USER=frank \
  -e POSTGRES_PASSWORD=frank \
  -e POSTGRES_DB=frank \
  -p 5432:5432 postgres:16
```

### 2. Apply migrations

```bash
migrate -path internal/db/migrations \
        -database "postgresql://frank:frank@localhost:5432/frank?sslmode=disable" up
```

### 3. Configure environment

```bash
cp .env.example .env
# Set DATABASE_URL and ANTHROPIC_API_KEY
```

### 4. (Optional) Add personal financial context

Create a  in the project root to give Claude background about how your finances
are structured — things like how payroll is split, which accounts are for transfers vs.
spending, or recurring charges that are expected. This file is gitignored and injected into
every analysis prompt automatically.

```bash
cp context.md.example context.md   # see the example for the expected format
# Edit context.md with your own details
```

If the file is absent, frank runs without any personal context — the AI will still work
but may flag intentional patterns as anomalies.

### 5. Build

```bash
go build ./...
```

### 5. Run a dry-run insight (no API call)

```bash
op run --env-file=.env.tpl -- go run ./cmd/insights --period biweekly --dry-run
```

### 6. Run a full insight

```bash
op run --env-file=.env.tpl -- go run ./cmd/insights --period biweekly
```

---

## Insights CLI

```
go run ./cmd/insights [flags]
```

| Flag | Default | Description |
|---|---|---|
| `--period` | `biweekly` | `biweekly` \| `monthly` \| `yearly` |
| `--days` | 0 (auto) | Override lookback window in days |
| `--model` | `claude-sonnet-4-6` | Any Anthropic model ID |
| `--thinking-budget` | `5000` | Extended thinking tokens (0 = disabled, min 1024) |
| `--dry-run` | `false` | Print prompts only — no API call, no DB write |

Eval records are written to `data/evals/<timestamp>_insights.jsonl`.

---

## Project Structure

```
frank/
├── cmd/
│   ├── insights/      # CLI: generate AI insights for a time period
│   └── server/        # Placeholder for future HTTP server
├── internal/
│   ├── db/            # Postgres connection, queries, migrations
│   ├── evals/         # JSONL eval record types and writer
│   ├── insights/      # Analyzer interface, Claude impl, prompt builder, generator
│   ├── testdb/        # Integration test helper (throwaway DB per test)
│   ├── alerts/        # Placeholder
│   ├── api/           # Placeholder
│   ├── etl/           # Placeholder
│   ├── reports/       # Placeholder
│   └── scraper/       # Placeholder
└── internal/db/migrations/   # 6 up/down SQL migration pairs
```

---

## Testing

```bash
# All tests (integration tests skip if Postgres unreachable)
go test ./...

# Verbose
go test -v ./internal/insights/...
```

Integration tests in `internal/db/` create and drop a throwaway database per test via `internal/testdb.New(t)`. They skip gracefully when Docker Postgres is unreachable.

---

## frank vs AutoBudget

frank is a ground-up rewrite of [AutoBudget](https://github.com/rorakhit/frank/blob/main/README.md), the prior TypeScript codebase. The differences reflect hard lessons from running AutoBudget in production.

| | AutoBudget | frank |
|---|---|---|
| **Language** | TypeScript + Fastify 5 | Go 1.26 |
| **Bank data** | Plaid API (webhook-driven) | Direct Playwright scraping |
| **Database** | Supabase (hosted PostgreSQL) | Self-hosted PostgreSQL (Docker) |
| **Migrations** | Supabase SQL editor | `golang-migrate` CLI |
| **AI** | Claude Haiku (categorization) + Sonnet (narratives) | Claude Sonnet (insights only) |
| **AI SDK** | Hand-rolled `fetch` calls | `anthropic-sdk-go` v1.43.0 |
| **LLM abstraction** | None — Claude calls hardcoded in place | `Analyzer` interface — Claude, Ollama, or any model |
| **Eval pipeline** | None | JSONL record per call: prompts, response, token counts, thinking |
| **Deployment** | Railway / Docker / Render | Local only (no server yet) |
| **HTTP server** | Fastify, full web dashboard | Not yet implemented |
| **Alerting** | Gmail (large purchases, subscriptions, credit thresholds) | Not yet implemented |
| **Recurring detection** | `recurring_charges` table + webhook-driven | Schema exists; ETL not yet implemented |
| **Notion integration** | Optional (7 pages) | Not planned |
| **Auth** | Single shared secret cookie | Not applicable (CLI only) |
| **Third-party cost** | Plaid (ongoing) + Supabase ($10/mo) | Zero — local stack |

### Why the rewrite?

**Plaid dependency.** Plaid charges per connected item per month and requires bank-by-bank approval for production access. Chase approval alone took weeks. Playwright scraping bypasses all of that — direct browser sessions, no intermediary, no approval process.

**Data ownership.** AutoBudget stored everything in Supabase (hosted). frank stores everything locally. Credentials, transaction data, and AI outputs never leave the machine.

**LLM testability.** AutoBudget's Claude calls were scattered inline — untestable without hitting the real API. frank's `Analyzer` interface makes the LLM a swappable dependency: tests use a `stubAnalyzer`, production uses `ClaudeAnalyzer`, and a local model is a drop-in.

**Eval pipeline.** Running different models against the same transaction data in AutoBudget required manual comparison. frank writes every call to JSONL with full input/output provenance, making model comparison systematic.

**Go.** Better performance, single binary, stricter type system, easier deployment. The Go standard library covers most of what Node/npm pulled in from third parties.

### What AutoBudget had that frank doesn't (yet)

- Web dashboard (frank: `cmd/server` is an empty placeholder)
- Gmail alerts
- Real-time webhook-driven sync (frank scrapes on demand)
- Notion integration (not planned)
- Apple Card CSV import UI

---

## Implementation Status

| Area | Status |
|---|---|
| PostgreSQL schema | Complete — 6 migrations, 14 tables |
| DB connection + queries | Complete — `FetchTransactions`, `InsertInsight` |
| Insights pipeline | Complete — prompt builder, Claude SDK, eval capture |
| `Analyzer` interface | Complete — swappable LLM dependency |
| Eval JSONL store | Complete — full record types, append writer |
| `cmd/insights` CLI | Complete |
| Test suite | Complete — 30+ cases: unit + integration |
| Bank scrapers | In progress — Python/Playwright, gitignored |
| Goals system | Planned — schema, DB queries, prompt integration, HTTP API |
| HTTP server | Not started |
| Frontend | Not started |
| Alerts | Placeholder only |
| ETL pipeline | Placeholder only |

---

## Documentation

Full technical documentation is in [`docs/`](docs/):

- [Project Overview](docs/project-overview.md)
- [Architecture](docs/architecture.md)
- [Data Models](docs/data-models.md)
- [API Contracts](docs/api-contracts.md)
- [Source Tree Analysis](docs/source-tree-analysis.md)
- [Development Guide](docs/development-guide.md)
