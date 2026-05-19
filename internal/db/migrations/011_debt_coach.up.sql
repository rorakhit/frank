CREATE TABLE debt_coach (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    payload     jsonb NOT NULL,
    generated_at timestamptz NOT NULL DEFAULT now()
);
