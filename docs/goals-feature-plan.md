# Goals Feature Plan

## Summary

A structured goal system where the user sets spending and savings targets across fixed time horizons. Active goals are injected into the Claude prompt as context so every insight cycle includes progress tracking and suggestions for improvement.

---

## User Decisions (confirmed)

| Dimension | Decision |
|---|---|
| Time horizons | Three fixed buckets: **monthly**, **quarterly** (3 months), **yearly** |
| Goal types | **Savings rate** (% of income), **spending cap** ($X on a category or overall), **free text** (plain language; Claude interprets) |
| Interface | **HTTP API** — REST endpoints for CRUD. CLI/SQL seeding as a stopgap until `cmd/server` is built. |

---

## Schema

### Drop `savings_goals`

The existing `savings_goals` table (migration 005) is thin and unwired. Drop it and replace with `goals`.

```sql
-- 007_goals.down.sql
DROP TABLE IF EXISTS goals;

-- 007_goals.up.sql
CREATE TABLE goals (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    type          text NOT NULL CHECK (type IN ('savings_rate', 'spending_cap', 'free_text')),
    horizon       text NOT NULL CHECK (horizon IN ('monthly', 'quarterly', 'yearly')),
    description   text NOT NULL,          -- human-readable label; required for all types
    target_value  numeric(10,2),          -- null for free_text; % for savings_rate; $ for spending_cap
    category      text,                   -- null unless type = 'spending_cap'
    active        boolean NOT NULL DEFAULT true,
    created_at    timestamptz NOT NULL DEFAULT now()
);
```

`description` is required for all types — it's what gets injected into the prompt.

---

## Progress Computation

For structured types, progress is computed from the transactions already present in `PeriodSummary` — no extra DB query needed at insight time.

| Type | How progress is computed |
|---|---|
| `savings_rate` | `(total_income - total_spend) / total_income * 100` vs `target_value` |
| `spending_cap` | Sum of debits in `category` (or all debits if no category) vs `target_value` |
| `free_text` | Not computed — Claude receives the description and interprets progress from transaction data |

For quarterly and yearly goals, the insight period (biweekly/monthly/yearly) may be shorter than the goal horizon. Claude should be told the goal horizon and current period so it can reason about run-rate and trajectory rather than just the current slice.

---

## Prompt Integration

`PeriodSummary` gains a `Goals` field:

```go
type GoalContext struct {
    Description  string
    Type         string
    Horizon      string
    TargetValue  *float64
    Category     string
    // Computed at prompt-build time for structured types; empty for free_text
    CurrentValue *float64
    Unit         string  // "%" for savings_rate, "$" for spending_cap
}

type PeriodSummary struct {
    // existing fields ...
    Goals []GoalContext
}
```

`BuildPrompts` adds an "Active Goals" section to the user prompt when `len(period.Goals) > 0`:

```
## Active Goals

- Save 20% of income per period (monthly) — current: 18.4% [close]
- Dining under $200/period (monthly) — current: $147.20 [on track]
- Pay down Chase card faster than minimum (yearly) — [assess from transactions]
```

Claude is instructed in the system prompt to comment on each active goal within the narrative and include at least one concrete suggestion per goal in `key_findings`.

---

## Internal Package API

### `internal/db`

New query functions (to be added to `queries.go`):

```go
// FetchActiveGoals returns all goals where active = true.
func FetchActiveGoals(ctx context.Context, pool *pgxpool.Pool) ([]Goal, error)

// InsertGoal inserts a new goal row.
func InsertGoal(ctx context.Context, pool *pgxpool.Pool, goal Goal) (Goal, error)

// DeactivateGoal sets active = false on the given goal.
func DeactivateGoal(ctx context.Context, pool *pgxpool.Pool, id string) error
```

```go
type Goal struct {
    ID          string
    Type        string
    Horizon     string
    Description string
    TargetValue *float64
    Category    string
    Active      bool
    CreatedAt   time.Time
}
```

### `internal/insights`

New function in `prompt.go` or a new `goals.go`:

```go
// BuildGoalContexts computes progress for structured goals from period transactions.
// Free-text goals pass through with nil CurrentValue.
func BuildGoalContexts(goals []db.Goal, period PeriodSummary) []GoalContext
```

---

## HTTP API (planned — requires `cmd/server`)

| Method | Path | Description |
|---|---|---|
| `GET` | `/goals` | List all goals (active and inactive) |
| `POST` | `/goals` | Create a goal |
| `PATCH` | `/goals/:id` | Update description, target, active status |
| `DELETE` | `/goals/:id` | Deactivate (soft delete — sets `active = false`) |

### `POST /goals` request body

```json
{
  "type": "spending_cap",
  "horizon": "monthly",
  "description": "Dining under $200 per period",
  "target_value": 200.00,
  "category": "Dining"
}
```

```json
{
  "type": "free_text",
  "horizon": "yearly",
  "description": "Pay down Chase card faster than the minimum each month"
}
```

---

## `cmd/insights` changes

`main.go` gains a step between `FetchTransactions` and `BuildPrompts`:

```go
goals, err := db.FetchActiveGoals(ctx, pool)
// build PeriodSummary with goal contexts attached
p.Goals = insights.BuildGoalContexts(goals, p)
```

No new flags needed. If no goals are active, the prompt is unchanged.

---

## Implementation Order

1. **Migration 007** — `goals` table, drop `savings_goals`
2. **`internal/db`** — `Goal` type, `FetchActiveGoals`, `InsertGoal`, `DeactivateGoal`; integration tests
3. **`internal/insights`** — `GoalContext` type, `BuildGoalContexts`; unit tests
4. **`internal/insights/prompt.go`** — add "Active Goals" section to `BuildPrompts`; prompt tests
5. **`cmd/insights/main.go`** — wire `FetchActiveGoals` → `BuildGoalContexts` → `PeriodSummary.Goals`
6. **System prompt update** — instruct Claude to comment on goals and include suggestions in `key_findings`
7. **HTTP endpoints** — after `cmd/server` exists: `GET/POST/PATCH/DELETE /goals`

Steps 1–6 can be built and used (via SQL-seeded goals) before the HTTP layer exists.

---

## Open Questions

- Should quarterly goals track cumulative progress across periods (requires storing per-period snapshots) or let Claude reason about run-rate from the current period alone? The latter is simpler and sufficient for now.
- `insights.goals` column (free-text user notes on a report) already exists — keep it as-is; it's separate from the structured `goals` table.
