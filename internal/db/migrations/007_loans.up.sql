-- Drop the old credit_accounts table (linked to scraped accounts, no data, superseded by this design)
DROP TABLE IF EXISTS credit_accounts;

-- Installment loans with fixed terms (mortgage, car, personal, 0% financing)
CREATE TABLE loans (
  id               uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  name             text          NOT NULL,           -- "Car Loan", "Mortgage", "Window Loan"
  lender           text          NOT NULL,           -- "Affinity FCU", "JPMorgan Chase", "Apple"
  original_amount  numeric(12,2) NOT NULL,
  interest_rate    numeric(7,5)  NOT NULL,           -- annual rate as decimal, e.g. 0.02875 for 2.875%
  term_months      int           NOT NULL,
  minimum_payment  numeric(10,2) NOT NULL,
  origination_date date          NOT NULL,
  account_source   text,                             -- frank account the payment comes from
  notes            text,
  active           boolean       NOT NULL DEFAULT true,
  created_at       timestamptz   NOT NULL DEFAULT now()
);

-- Revolving credit accounts (credit cards) — manually maintained balances
CREATE TABLE credit_accounts (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text          NOT NULL,            -- "Chase Sapphire Preferred", "Affinity Visa"
  lender          text          NOT NULL,
  credit_limit    numeric(10,2) NOT NULL,
  current_balance numeric(10,2) NOT NULL,            -- manually updated
  interest_rate   numeric(7,5)  NOT NULL,            -- APR as decimal
  minimum_payment numeric(10,2),
  due_day         int,                               -- day of month payment is due
  notes           text,
  active          boolean       NOT NULL DEFAULT true,
  updated_at      timestamptz   NOT NULL DEFAULT now(),
  created_at      timestamptz   NOT NULL DEFAULT now()
);
