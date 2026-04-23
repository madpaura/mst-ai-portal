-- Add status tracking to guest_interests so admins can mark entries as contacted/dismissed
ALTER TABLE guest_interests
    ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'contacted', 'dismissed')),
    ADD COLUMN IF NOT EXISTS admin_note TEXT,
    ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_guest_interests_status ON guest_interests (status);
