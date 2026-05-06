alter table accounts add column if not exists display_name text;

create table if not exists custom_categories (
  name        text primary key,
  created_at  timestamptz default now()
);
