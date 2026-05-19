-- Drop old schema if it exists (different column layout from prior session)
DROP TABLE IF EXISTS categorization_rules;

-- Categorization rules: match transactions by description pattern and assign category/flags
CREATE TABLE categorization_rules (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    pattern         text        NOT NULL,          -- substring match (case-insensitive)
    category        text        NOT NULL DEFAULT '',
    is_recurring    boolean     NOT NULL DEFAULT false,
    cadence         text        NOT NULL DEFAULT '', -- 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'yearly'
    is_internal     boolean     NOT NULL DEFAULT false,  -- vault/internal transfers to exclude from spend/income
    notes           text        NOT NULL DEFAULT '',
    created_at      timestamptz NOT NULL DEFAULT now()
);

-- Seed known vault and internal transfer patterns
INSERT INTO categorization_rules (pattern, category, is_internal, notes) VALUES
    ('RoundUps Vault',          'Internal Transfer', true, 'SoFi vault deposit/withdrawal'),
    ('DEPOSIT_VAULT',           'Internal Transfer', true, 'SoFi vault raw_type match'),
    ('WITHDRAWAL_VAULT',        'Internal Transfer', true, 'SoFi vault raw_type match'),
    ('INTERNAL_TRANSFER',       'Internal Transfer', true, 'SoFi inter-account transfer'),
    ('TRANSFER_CREDIT',         'Internal Transfer', true, 'Affinity inter-account transfer');

-- Add is_internal flag to transactions table so ETL can mark them on ingest
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS is_internal boolean NOT NULL DEFAULT false;
