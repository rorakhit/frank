CREATE TABLE categorization_rules (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  label               text,
  match_name_contains text,
  match_amount_min    numeric,
  match_amount_max    numeric,
  match_day_of_week   smallint,
  category            text        NOT NULL,
  priority            int         NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE custom_categories (
  name       text        PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);
