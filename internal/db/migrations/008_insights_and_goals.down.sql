DROP TABLE IF EXISTS goals;

CREATE TABLE savings_goals (
  id           uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  target_type  text         CHECK (target_type IN ('fixed', 'percentage')),
  target_value numeric(10,2),
  created_at   timestamptz  NOT NULL DEFAULT now()
);

ALTER TABLE insights
  DROP COLUMN IF EXISTS thinking_text,
  DROP COLUMN IF EXISTS model,
  DROP COLUMN IF EXISTS input_tokens,
  DROP COLUMN IF EXISTS output_tokens;
