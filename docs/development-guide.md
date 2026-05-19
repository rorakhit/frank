# Development Guide — frank

## Prerequisites

- Go 1.26+
- Docker (for local Postgres)
- `golang-migrate` CLI: `brew install golang-migrate`

---

## Local Postgres Setup

```bash
docker run -d --name frank-postgres \
  -e POSTGRES_USER=frank \
  -e POSTGRES_PASSWORD=frank \
  -e POSTGRES_DB=frank \
  -p 5432:5432 postgres:16
```

Apply migrations:

```bash
migrate -path internal/db/migrations \
        -database "postgresql://frank:frank@localhost:5432/frank?sslmode=disable" up
```

Rollback one step:

```bash
migrate -path internal/db/migrations \
        -database "postgresql://frank:frank@localhost:5432/frank?sslmode=disable" down 1
```

---

## Environment Variables

Copy `.env.example` to `.env`:

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | e.g. `postgresql://frank:frank@localhost:5432/frank?sslmode=disable` |
| `ANTHROPIC_API_KEY` | Yes (unless `--dry-run`) | Anthropic API key |

---

## Build and Test

```bash
go build ./...

# All tests (integration tests skip if Postgres unreachable)
go test ./...

# Verbose
go test -v ./internal/insights/...
```

Integration tests in `internal/db/` require Docker Postgres. They create and drop a throwaway database per test via `internal/testdb.New(t)`.

---

## Running the Insights CLI

**Dry run** (prints prompts, no API call, no DB write):

```bash
DATABASE_URL="postgresql://frank:frank@localhost:5432/frank?sslmode=disable" \
go run ./cmd/insights --period biweekly --dry-run
```

**Full run:**

```bash
DATABASE_URL="postgresql://..." ANTHROPIC_API_KEY="sk-ant-..." \
go run ./cmd/insights --period biweekly --thinking-budget 5000
```

**Flags:**

| Flag | Default | Description |
|---|---|---|
| `--period` | `biweekly` | `biweekly` \| `monthly` \| `yearly` |
| `--days` | 0 (auto) | Override lookback window in days |
| `--model` | `claude-sonnet-4-6` | Any Anthropic model ID |
| `--thinking-budget` | `5000` | Extended thinking tokens (0 = disabled, min 1024) |
| `--dry-run` | `false` | Print prompts only |

Eval records are written to `data/evals/<timestamp>_insights.jsonl` (excluded from git).

---

## Adding a Migration

1. Create `internal/db/migrations/00N_<name>.up.sql` and `.down.sql`
2. Run `migrate ... up`
3. Add queries to `internal/db/queries.go`
4. Add integration tests in `internal/db/queries_test.go`

---

## Git Hooks

`.git/hooks/commit-msg` strips `Co-Authored-By: ... <noreply@anthropic.com>` from commit messages automatically.

---

## Code Style

- `gofmt` only — no other formatter
- Error wrapping: always `fmt.Errorf("context: %w", err)`, never bare `err`
- No boilerplate comments — only document non-obvious constraints
- Tests: standard library `testing` package, no third-party assertion libraries

---

## AI Prompt Notes

### Extended thinking

Not worth the token cost for current prompts (paydown coach, insights, categorization) — these are structured JSON generation tasks where prompt and data quality are the ceiling, not reasoning depth.

**Enable it when implementing the yearly financial review prompt.** Synthesizing 12 months of transactions + all debt + goals into a forward-looking financial plan is the kind of compound reasoning task where extended thinking budget earns its cost.

Note for local LLM migration: thinking traces don't transfer between models. What helps local LLM tuning is high-quality prompt/response pairs with clean structured outputs — which frank already generates.
