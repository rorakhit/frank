DROP TABLE IF EXISTS credit_accounts;
DROP TABLE IF EXISTS loans;

-- Restore the original credit_accounts table
CREATE TABLE credit_accounts (
  id          uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid          NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
  apr         numeric(5,2),
  credit_limit numeric(10,2),
  updated_at  timestamptz   NOT NULL DEFAULT now()
);
