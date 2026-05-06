create table if not exists categorization_rules (
  id                  uuid primary key default gen_random_uuid(),
  label               text not null,
  match_name_contains text,
  match_amount_min    numeric,
  match_amount_max    numeric,
  match_day_of_week   smallint check (match_day_of_week between 0 and 6),
  category            text not null,
  priority            int not null default 0,
  created_at          timestamptz default now()
);
