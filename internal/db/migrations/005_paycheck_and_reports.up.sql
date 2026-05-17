CREATE TABLE paycheck_patterns (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  pattern    text        NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE savings_goals (
  id           uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  target_type  text         CHECK (target_type IN ('fixed', 'percentage')),
  target_value numeric(10,2),
  created_at   timestamptz  NOT NULL DEFAULT now()
);

CREATE TABLE savings_events (
  id              uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  paycheck_amount numeric(10,2),
  period_start    date,
  period_end      date         UNIQUE,
  notes           text,
  created_at      timestamptz  NOT NULL DEFAULT now()
);

CREATE TABLE insights (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  period_start date        NOT NULL,
  period_end   date        NOT NULL,
  period_type  text        NOT NULL CHECK (period_type IN ('biweekly', 'monthly', 'yearly')),
  raw_analysis text,
  key_findings jsonb,
  goals        text,
  generated_at timestamptz NOT NULL DEFAULT now()
);
