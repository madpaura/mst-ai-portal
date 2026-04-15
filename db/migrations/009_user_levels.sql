-- Migration 009: User levels (content role) + contribution requests (Issue #34)

-- Add 'content' role: admin > content > user
-- content can create/edit videos, articles, marketplace entries
-- user can only view

-- Update role check constraint to include 'content'
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
    CHECK (role IN ('user', 'content', 'admin'));

-- Contribution request registration
CREATE TABLE IF NOT EXISTS contribute_requests (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
    reason      TEXT NOT NULL,
    status      TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    admin_note  TEXT,
    reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMPTZ,
    created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contribute_requests_user_id ON contribute_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_contribute_requests_status ON contribute_requests(status);
