CREATE TABLE categorization_suggestions (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    suggestion_type text        NOT NULL CHECK (suggestion_type IN ('transaction', 'rule')),
    status          text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'dismissed')),

    -- For transaction suggestions: link to the transaction
    transaction_description text,
    transaction_date        date,
    transaction_amount      numeric,
    transaction_direction   text,

    -- Proposed values (shared by both types)
    pattern         text,       -- for rule suggestions: the proposed pattern
    category        text        NOT NULL DEFAULT '',
    is_recurring    boolean     NOT NULL DEFAULT false,
    cadence         text        NOT NULL DEFAULT '',
    is_internal     boolean     NOT NULL DEFAULT false,
    confidence      integer     NOT NULL DEFAULT 0, -- 0-100
    notes           text        NOT NULL DEFAULT '',

    created_at      timestamptz NOT NULL DEFAULT now(),
    reviewed_at     timestamptz
);

CREATE INDEX categorization_suggestions_status ON categorization_suggestions (status);
