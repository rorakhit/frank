-- Track when each plaid item was last synced
ALTER TABLE plaid_items ADD COLUMN IF NOT EXISTS last_synced_at timestamptz;

-- Track manual sync invocations for quota enforcement
CREATE TABLE IF NOT EXISTS manual_syncs (
  id      uuid primary key default gen_random_uuid(),
  synced_at timestamptz default now()
);
