CREATE TABLE recurring_merchants (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  description_normal  text        NOT NULL UNIQUE,
  display_name        text,
  detected_frequency  text        CHECK (detected_frequency IN ('weekly', 'monthly', 'quarterly')),
  detected_amount_avg numeric(10,2),
  user_override       text        CHECK (user_override IN ('recurring', 'not_recurring')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE transactions (
  id                  uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id          uuid         NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  source_tx_id        text         NOT NULL,
  date                date         NOT NULL,
  amount              numeric(10,2) NOT NULL,
  direction           text         NOT NULL CHECK (direction IN ('debit', 'credit')),
  description         text,
  description_normal  text,
  raw_type            text,
  is_pending          boolean      NOT NULL DEFAULT false,
  is_income           boolean      NOT NULL DEFAULT false,
  is_recurring        boolean      NOT NULL DEFAULT false,
  category            text,
  category_confidence int,
  flagged_for_review  boolean      NOT NULL DEFAULT true,
  raw                 jsonb,
  created_at          timestamptz  NOT NULL DEFAULT now(),
  UNIQUE (account_id, source_tx_id)
);

CREATE INDEX ON transactions (date);
CREATE INDEX ON transactions (account_id);
CREATE INDEX ON transactions (description_normal);
CREATE INDEX ON transactions (flagged_for_review) WHERE flagged_for_review = true;
CREATE INDEX ON transactions (is_pending) WHERE is_pending = true;
