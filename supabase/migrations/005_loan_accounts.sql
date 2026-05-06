create table if not exists loan_accounts (
  id               uuid primary key default gen_random_uuid(),
  account_id       uuid references accounts(id) on delete cascade unique,
  apr              numeric(5,2),
  original_balance numeric(10,2),
  updated_at       timestamptz default now()
);

alter table loan_accounts enable row level security;
create policy "service role only" on loan_accounts using (false);
