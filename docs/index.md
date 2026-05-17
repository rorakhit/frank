# frank — Documentation Index

**frank** is a self-hosted personal finance tool. It scrapes transactions directly from bank websites (Affinity FCU, SoFi, Chase), stores them in PostgreSQL, and uses Claude to generate AI-powered spending insights.

---

## Quick Reference

|                 |                                    |
|-----------------|------------------------------------|
| **Language**    | Go 1.26.1                          |
| **Module**      | `github.com/rorakhit/frank`        |
| **Database**    | PostgreSQL 16 (pgx/v5 driver)      |
| **AI SDK**      | `anthropic-sdk-go v1.43.0`         |
| **Migrations**  | `golang-migrate` CLI               |
| **Scraping**    | Python 3 + Playwright (gitignored) |
| **Entry point** | `go run ./cmd/insights`            |
| **HTTP server** | Not yet implemented                |

---

## Documents

- [Project Overview](./project-overview.md) — What frank is, core capabilities, technology stack, implementation status
- [Architecture](./architecture.md) — System diagram, package responsibilities, AI pipeline design, testing architecture
- [Data Models](./data-models.md) — All 14 tables across 6 migrations, column details, constraints, indexes, ER diagram
- [API Contracts](./api-contracts.md) — CLI interface (`cmd/insights`), internal package APIs, planned HTTP endpoints
- [Source Tree Analysis](./source-tree-analysis.md) — Annotated directory tree, entry points, dependency graph, test coverage
- [Development Guide](./development-guide.md) — Local Postgres setup, migrations, build/test commands, CLI usage, code style

### Feature Plans

- [Goals Feature Plan](./goals-feature-plan.md) — Structured goal tracking (savings rate, spending cap, free text) with Claude prompt integration

---

## Architecture in One Diagram

```
cmd/insights (CLI)
    └── internal/insights
            ├── Analyzer interface  ← swappable LLM backend
            ├── ClaudeAnalyzer      ← anthropic-sdk-go
            ├── Generate()
            └── BuildPrompts()
                    ├── internal/evals   ← JSONL eval store
                    └── internal/db      ← Postgres queries + migrations
                                └── PostgreSQL (14 tables, 6 migrations)
```

---

## Current Implementation Status

| Area | Status |
|---|---|
| PostgreSQL schema | Complete — 6 migrations, 14 tables |
| DB connection + queries | Complete — `FetchTransactions`, `InsertInsight` |
| Insights pipeline | Complete — prompt builder, Claude SDK, eval capture |
| `Analyzer` interface | Complete — swappable LLM dependency |
| Eval JSONL store | Complete — full record types, append writer |
| `cmd/insights` CLI | Complete — `--period`, `--days`, `--model`, `--thinking-budget`, `--dry-run` |
| Test suite | Complete — 30+ cases: unit + integration |
| Bank scrapers | In progress — Python/Playwright, gitignored |
| HTTP server | Not started |
| Frontend | Not started |
| Alerts | Placeholder only |
| ETL pipeline | Placeholder only |
