# Data Models — frank

All tables use `uuid` primary keys generated with `gen_random_uuid()`. All timestamps are `timestamptz`. Migrations live in `internal/db/migrations/` and are applied via the `golang-migrate` CLI.

---

## Migration 001 — Core

### `institutions`

Seed data: Affinity FCU (`affinity`), SoFi (`sofi`), Chase (`chase`).

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `source` | text UNIQUE NOT NULL | `'affinity'` \| `'sofi'` \| `'chase'` |
| `display_name` | text NOT NULL | Human-readable name |
| `last_scraped_at` | timestamptz | Null until first successful scrape |
| `last_scrape_ok` | boolean | Result of most recent scrape |
| `last_scrape_error` | text | Error message if last scrape failed |
| `created_at` | timestamptz NOT NULL | `DEFAULT now()` |

### `accounts`

One row per bank account (checking, savings, credit card).

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `institution_id` | uuid FK → institutions | |
| `source_account_id` | text NOT NULL | Bank's internal account ID |
| `name` | text NOT NULL | Account name from bank |
| `display_name` | text | User-overridden display name |
| `type` | text NOT NULL | e.g. `'checking'`, `'savings'`, `'credit'` |
| `mask` | text | Last 4 digits |
| `created_at` | timestamptz NOT NULL | |

UNIQUE constraint: `(institution_id, source_account_id)`.

---

## Migration 002 — Transactions

### `recurring_merchants`

Detected recurring merchants with frequency and amount averages.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `description_normal` | text UNIQUE NOT NULL | Normalized merchant name |
| `display_name` | text | Human-readable override |
| `detected_frequency` | text | CHECK IN ('weekly', 'monthly', 'quarterly') |
| `detected_amount_avg` | numeric(10,2) | Rolling average charge amount |
| `user_override` | text | CHECK IN ('recurring', 'not_recurring') |
| `created_at` | timestamptz NOT NULL | |
| `updated_at` | timestamptz NOT NULL | |

### `transactions`

Core financial data. Every scraped transaction lands here.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `account_id` | uuid FK → accounts | CASCADE DELETE |
| `source_tx_id` | text NOT NULL | Bank's transaction ID |
| `date` | date NOT NULL | Posted date |
| `amount` | numeric(10,2) NOT NULL | Always positive |
| `direction` | text NOT NULL | CHECK IN ('debit', 'credit') |
| `description` | text | Raw bank description |
| `description_normal` | text | Normalized/cleaned description |
| `raw_type` | text | Bank's transaction type string |
| `is_pending` | boolean NOT NULL | DEFAULT false |
| `is_income` | boolean NOT NULL | DEFAULT false |
| `is_recurring` | boolean NOT NULL | DEFAULT false |
| `category` | text | AI or rule-assigned category |
| `category_confidence` | int | 0–100 |
| `flagged_for_review` | boolean NOT NULL | DEFAULT true |
| `raw` | jsonb | Full raw bank response |
| `created_at` | timestamptz NOT NULL | |

UNIQUE: `(account_id, source_tx_id)`. Indexes: `date`, `account_id`, `description_normal`, partial on `flagged_for_review = true`, partial on `is_pending = true`.

---

## Migration 003 — Financial Metadata

### `balance_snapshots`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `account_id` | uuid FK → accounts | |
| `balance` | numeric(10,2) NOT NULL | Always positive |
| `snapshot_at` | timestamptz NOT NULL | DEFAULT now() |

Index: `(account_id, snapshot_at DESC)`.

### `credit_accounts`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `account_id` | uuid FK → accounts UNIQUE | One-to-one |
| `apr` | numeric(5,2) | |
| `credit_limit` | numeric(10,2) | |
| `updated_at` | timestamptz NOT NULL | |

### `loan_accounts`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `account_id` | uuid FK → accounts UNIQUE | One-to-one |
| `apr` | numeric(5,2) | |
| `original_balance` | numeric(10,2) | |
| `updated_at` | timestamptz NOT NULL | |

---

## Migration 004 — Categorization

### `categorization_rules`

User-defined rules that override AI categorization.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `label` | text | Human label |
| `match_name_contains` | text | Case-insensitive substring |
| `match_amount_min` | numeric | Optional lower bound |
| `match_amount_max` | numeric | Optional upper bound |
| `match_day_of_week` | smallint | 0=Sun … 6=Sat |
| `category` | text NOT NULL | Category to assign |
| `priority` | int NOT NULL | DEFAULT 0; higher = checked first |
| `created_at` | timestamptz NOT NULL | |

### `custom_categories`

| Column | Type | Notes |
|---|---|---|
| `name` | text PK | |
| `created_at` | timestamptz NOT NULL | |

---

## Migration 005 — Paycheck and Reports

### `paycheck_patterns`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `pattern` | text UNIQUE NOT NULL | Employer name fragment |
| `created_at` | timestamptz NOT NULL | |

### `savings_goals`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `target_type` | text | CHECK IN ('fixed', 'percentage') |
| `target_value` | numeric(10,2) | |
| `created_at` | timestamptz NOT NULL | |

### `savings_events`

`period_end` UNIQUE is the authoritative dedup gate for paycheck report generation.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `paycheck_amount` | numeric(10,2) | |
| `period_start` | date | |
| `period_end` | date UNIQUE | |
| `notes` | text | |
| `created_at` | timestamptz NOT NULL | |

### `insights`

AI-generated spending reports written after every successful Claude call.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `period_start` | date NOT NULL | |
| `period_end` | date NOT NULL | |
| `period_type` | text NOT NULL | CHECK IN ('biweekly', 'monthly', 'yearly') |
| `raw_analysis` | text | Claude's narrative prose |
| `key_findings` | jsonb | Array of finding strings |
| `goals` | text | User notes for the period |
| `generated_at` | timestamptz NOT NULL | DEFAULT now() |

---

## Migration 006 — Scrape Runs

### `scrape_runs`

Audit log for every scraper execution.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `institution_id` | uuid FK → institutions NOT NULL | |
| `started_at` | timestamptz NOT NULL | DEFAULT now() |
| `finished_at` | timestamptz | Null until completion |
| `ok` | boolean | True = success |
| `txns_added` | int NOT NULL | DEFAULT 0 |
| `txns_updated` | int NOT NULL | DEFAULT 0 |
| `error` | text | |
| `created_at` | timestamptz NOT NULL | |

Index: `(institution_id, started_at DESC)`.

---

## Entity Relationships

```
institutions (3 seed rows: affinity, sofi, chase)
    │
    ├── accounts
    │       ├── transactions
    │       ├── balance_snapshots
    │       ├── credit_accounts (1:1)
    │       └── loan_accounts (1:1)
    │
    └── scrape_runs

categorization_rules    (independent)
custom_categories       (independent)
paycheck_patterns       (independent)
savings_goals           (independent)
savings_events          (one per paycheck period)
insights                (one per AI report)
recurring_merchants     (independent)
```
