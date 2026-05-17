-- Extend insights with thinking text and token metadata
ALTER TABLE insights
  ADD COLUMN thinking_text text,
  ADD COLUMN model         text,
  ADD COLUMN input_tokens  int,
  ADD COLUMN output_tokens int;

-- Drop the thin, unwired savings_goals table
DROP TABLE IF EXISTS savings_goals;

-- Structured + free-text goal tracking
CREATE TABLE goals (
  id           uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  type         text          NOT NULL CHECK (type IN ('savings_rate', 'spending_cap', 'free_text')),
  horizon      text          NOT NULL CHECK (horizon IN ('monthly', 'quarterly', 'yearly')),
  description  text          NOT NULL,
  target_value numeric(10,2),          -- null for free_text; % for savings_rate; $ for spending_cap
  category     text,                   -- null unless type = 'spending_cap'
  active       boolean       NOT NULL DEFAULT true,
  created_at   timestamptz   NOT NULL DEFAULT now()
);
