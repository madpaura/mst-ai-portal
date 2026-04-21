-- Migration 012: add launch_url to solution_cards + guest_interests table

ALTER TABLE solution_cards ADD COLUMN IF NOT EXISTS launch_url TEXT;

CREATE TABLE IF NOT EXISTS guest_interests (
    id          BIGSERIAL PRIMARY KEY,
    email       TEXT NOT NULL,
    source      TEXT DEFAULT 'contribute',
    created_at  TIMESTAMPTZ DEFAULT now()
);
