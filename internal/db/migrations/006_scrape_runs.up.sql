CREATE TABLE scrape_runs (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid        NOT NULL REFERENCES institutions(id),
  started_at     timestamptz NOT NULL DEFAULT now(),
  finished_at    timestamptz,
  ok             boolean,
  txns_added     int         NOT NULL DEFAULT 0,
  txns_updated   int         NOT NULL DEFAULT 0,
  error          text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ON scrape_runs (institution_id, started_at DESC);
