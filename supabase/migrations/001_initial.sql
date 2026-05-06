-- Run this in Supabase Dashboard → SQL Editor

create extension if not exists "pgcrypto";

create table if not exists plaid_items (
  id               uuid primary key default gen_random_uuid(),
  plaid_item_id    text not null unique,
  access_token     text not null,
  institution_id   text not null,
  institution_name text not null,
  cursor           text,
  created_at       timestamptz default now()
);

create table if not exists accounts (
  id               uuid primary key default gen_random_uuid(),
  plaid_item_id    uuid references plaid_items(id) on delete cascade,
  plaid_account_id text not null unique,
  name             text not null,
  type             text not null,
  subtype          text,
  mask             text
);

create table if not exists transactions (
  id                   uuid primary key default gen_random_uuid(),
  plaid_transaction_id text not null unique,
  account_id           uuid references accounts(id) on delete cascade,
  amount               numeric(10,2) not null,
  merchant_name        text,
  date                 date not null,
  category             text,
  category_confidence  int,
  is_recurring         boolean not null default false,
  is_income            boolean not null default false,
  flagged_for_review   boolean not null default false,
  raw_plaid_data       jsonb,
  created_at           timestamptz default now()
);

create index if not exists transactions_date_idx on transactions(date);
create index if not exists transactions_account_id_idx on transactions(account_id);
create index if not exists transactions_merchant_idx on transactions(merchant_name);

create table if not exists recurring_charges (
  id             uuid primary key default gen_random_uuid(),
  merchant_name  text not null unique,
  average_amount numeric(10,2),
  frequency      text,
  last_seen      date,
  first_seen     date,
  is_active      boolean not null default true
);

create table if not exists credit_accounts (
  id               uuid primary key default gen_random_uuid(),
  account_id       uuid references accounts(id) on delete cascade unique,
  apr              numeric(5,2) not null,
  credit_limit     numeric(10,2) not null,
  is_variable_rate boolean not null default true,
  updated_at       timestamptz default now()
);

create table if not exists insights (
  id           uuid primary key default gen_random_uuid(),
  period_start date not null,
  period_end   date not null,
  period_type  text not null check (period_type in ('biweekly', 'monthly', 'yearly')),
  raw_analysis text,
  key_findings jsonb,
  generated_at timestamptz default now()
);

create table if not exists balance_snapshots (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid references accounts(id) on delete cascade,
  balance     numeric(10,2) not null,
  snapshot_at timestamptz default now()
);

create index if not exists balance_snapshots_account_time_idx
  on balance_snapshots(account_id, snapshot_at desc);

create table if not exists savings_goals (
  id           uuid primary key default gen_random_uuid(),
  target_type  text not null check (target_type in ('fixed', 'percentage')),
  target_value numeric(10,2),
  created_at   timestamptz default now()
);

create table if not exists savings_events (
  id                 uuid primary key default gen_random_uuid(),
  paycheck_amount    numeric(10,2) not null,
  recommended_amount numeric(10,2),
  actual_amount      numeric(10,2),
  period_start       date,
  period_end         date,
  notes              text,
  created_at         timestamptz default now()
);

create table if not exists notion_pages (
  id             text primary key,
  notion_page_id text not null,
  created_at     timestamptz default now()
);
