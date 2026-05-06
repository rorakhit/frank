-- Run after 001_initial.sql
-- Enables RLS on all tables. Service role key bypasses RLS automatically.
-- anon key cannot access any data.

alter table plaid_items        enable row level security;
alter table accounts           enable row level security;
alter table transactions       enable row level security;
alter table recurring_charges  enable row level security;
alter table credit_accounts    enable row level security;
alter table insights           enable row level security;
alter table balance_snapshots  enable row level security;
alter table savings_goals      enable row level security;
alter table savings_events     enable row level security;
alter table notion_pages       enable row level security;
