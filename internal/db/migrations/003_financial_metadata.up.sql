CREATE TABLE balance_snapshots (
  id          uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid         NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  balance     numeric(10,2) NOT NULL,
  snapshot_at timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX ON balance_snapshots (account_id, snapshot_at DESC);

CREATE TABLE credit_accounts (
  id           uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id   uuid         NOT NULL REFERENCES accounts(id) ON DELETE CASCADE UNIQUE,
  apr          numeric(5,2),
  credit_limit numeric(10,2),
  updated_at   timestamptz  NOT NULL DEFAULT now()
);

CREATE TABLE loan_accounts (
  id               uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       uuid         NOT NULL REFERENCES accounts(id) ON DELETE CASCADE UNIQUE,
  apr              numeric(5,2),
  original_balance numeric(10,2),
  updated_at       timestamptz  NOT NULL DEFAULT now()
);
