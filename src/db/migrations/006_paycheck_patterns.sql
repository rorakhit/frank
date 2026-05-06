create table if not exists paycheck_patterns (
  id         uuid primary key default gen_random_uuid(),
  pattern    text not null unique,
  created_at timestamptz default now()
);

alter table accounts drop column if exists is_paycheck_account;
