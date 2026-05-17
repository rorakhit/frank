# Project Overview — frank

## What Is frank?

frank is a self-hosted personal finance automation tool built for a single user. It scrapes transactions directly from bank websites (Affinity FCU, SoFi, Chase), stores them in PostgreSQL, and uses Claude to generate AI-powered spending insights on a biweekly, monthly, or yearly basis.

The project is a **Go rewrite** of a prior TypeScript/Plaid codebase. The central design decision is to own the data pipeline end-to-end — no Plaid dependency, no third-party aggregator, no ongoing subscription cost. Bank credentials and transaction data never leave the local machine.

---

## Core Value Proposition

| Capability | How it works |
|---|---|
| Direct bank scraping | Playwright (Python/asyncio) automates real browser sessions for Affinity FCU, SoFi, and Chase. Persistent Chrome profile maintains Chase device trust across runs. |
| AI spending insights | Claude generates narrative analysis and key findings for any time window. Prompt caching and extended thinking are both supported. |
| Goal tracking | Structured goals (savings rate, spending cap, free text) across monthly/quarterly/yearly horizons. Active goals are injected into the Claude prompt so every insight cycle includes progress tracking and improvement suggestions. |
| LLM eval pipeline | Every Claude call writes a full JSONL eval record (prompts, response, token usage, thinking text, stop reason). Designed for local model comparison. |
| Swappable LLM backend | `Analyzer` interface decouples the insights pipeline from Claude. OllamaAnalyzer can be dropped in with no changes to `Generate`. |
| Postgres-native storage | All financial data in a properly normalized PostgreSQL schema with migrations, indexes, and check constraints. |
| Integration test infrastructure | Throwaway test databases created per test, all migrations run, cleaned up automatically. Tests skip gracefully when Docker Postgres is unreachable. |

---

## What frank Is NOT

- Not a budgeting app with envelope tracking (but goal-based targets are planned)
- Not multi-user
- Not dependent on Plaid or any paid aggregator
- Not yet running a web server (the `cmd/server` placeholder is empty)
- Not a mobile app

---

## Technology Stack

| Layer | Technology |
|---|---|
| Language | Go 1.26.1 |
| Module | `github.com/rorakhit/frank` |
| Database driver | `pgx/v5` (pgxpool for connection pooling) |
| LLM SDK | `anthropic-sdk-go v1.43.0` |
| Migrations | golang-migrate CLI (`migrate -path internal/db/migrations -database ...`) |
| ID generation | `google/uuid` |
| Scraping | Python 3 + Playwright (async, headed Chrome) |
| Credential management | 1Password CLI service account token; TOTP seeds in `.env` |
| Testing | `go test` standard library; throwaway Postgres via `internal/testdb` |

---

## Repository Structure

```
frank/
├── cmd/
│   ├── insights/      # CLI: generate AI insights for a time period
│   └── server/        # Placeholder for future HTTP server
├── internal/
│   ├── db/            # Postgres connection, queries, migrations
│   ├── evals/         # JSONL eval record types and writer
│   ├── insights/      # Analyzer interface, Claude impl, prompt builder, generator
│   ├── testdb/        # Integration test helper (throwaway DB)
│   ├── alerts/        # Placeholder
│   ├── api/           # Placeholder
│   ├── etl/           # Placeholder
│   ├── reports/       # Placeholder
│   └── scraper/       # Placeholder
├── internal/db/migrations/   # 6 up/down SQL migration pairs
├── docs/              # Project documentation
├── go.mod
└── go.sum
```

---

## Current Implementation Status

| Area | Status |
|---|---|
| PostgreSQL schema | ✅ Complete — 6 migrations, 14 tables |
| DB connection + queries | ✅ `FetchTransactions`, `InsertInsight` |
| Insights pipeline | ✅ Prompt builder, Claude SDK integration, eval capture |
| `Analyzer` interface | ✅ Swappable LLM dependency |
| Eval JSONL store | ✅ Full record types, append writer, RunFile naming |
| `cmd/insights` CLI | ✅ Flags: `--period`, `--days`, `--model`, `--thinking-budget`, `--dry-run` |
| Test suite | ✅ Unit + integration tests; 30+ test cases across all packages |
| Bank scrapers | 🚧 Python/Playwright — gitignored (ToS sensitivity) |
| Goals system | 📋 Planned — schema, DB queries, prompt integration, HTTP API (see [goals-feature-plan.md](./goals-feature-plan.md)) |
| HTTP server | ⬜ Not yet started |
| Frontend | ⬜ Not yet started |
| Alerts | ⬜ Placeholder only |
| ETL pipeline | ⬜ Placeholder only |
