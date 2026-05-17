CREATE TABLE institutions (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  source             text        NOT NULL UNIQUE, -- 'affinity_fcu' | 'sofi' | 'chase'
  display_name       text        NOT NULL,
  last_scraped_at    timestamptz,
  last_scrape_ok     boolean,
  last_scrape_error  text,
  created_at         timestamptz NOT NULL DEFAULT now()
);

INSERT INTO institutions (source, display_name) VALUES
  ('affinity_fcu', 'Affinity FCU'),
  ('sofi',     'SoFi'),
  ('chase',    'Chase');

CREATE TABLE accounts (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id    uuid        NOT NULL REFERENCES institutions(id),
  source_account_id text        NOT NULL,
  name              text        NOT NULL,
  display_name      text,
  type              text        NOT NULL,
  mask              text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (institution_id, source_account_id)
);
