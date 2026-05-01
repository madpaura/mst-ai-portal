"""auto_mode — transcript pipeline tables and settings columns

Revision ID: 0002
Revises: 0001
Create Date: 2026-05-01
"""

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from alembic import op

    op.execute("""
-- ── videos: auto mode columns ────────────────────────────────
ALTER TABLE videos
    ADD COLUMN IF NOT EXISTS auto_mode         BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS transcript_status TEXT
        CHECK (transcript_status IN ('pending', 'processing', 'ready', 'error')),
    ADD COLUMN IF NOT EXISTS transcript_path   TEXT,
    ADD COLUMN IF NOT EXISTS transcript_error  TEXT;

-- ── auto_jobs: pipeline job queue ────────────────────────────
CREATE TABLE IF NOT EXISTS auto_jobs (
    id           BIGSERIAL PRIMARY KEY,
    video_id     UUID NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    kind         TEXT NOT NULL CHECK (kind IN ('transcript', 'metadata', 'chapters', 'howto')),
    status       TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled')),
    attempts     INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 3,
    error        TEXT,
    payload      JSONB,
    started_at   TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_auto_jobs_status   ON auto_jobs (status, created_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_auto_jobs_video_id ON auto_jobs (video_id);

-- ── forge_settings: transcript service fields ─────────────────
ALTER TABLE forge_settings
    ADD COLUMN IF NOT EXISTS transcript_service_url     TEXT,
    ADD COLUMN IF NOT EXISTS transcript_service_api_key TEXT,
    ADD COLUMN IF NOT EXISTS transcript_model           TEXT DEFAULT 'large-v3';
""")


def downgrade() -> None:
    from alembic import op

    op.execute("""
DROP TABLE IF EXISTS auto_jobs;

ALTER TABLE videos
    DROP COLUMN IF EXISTS auto_mode,
    DROP COLUMN IF EXISTS transcript_status,
    DROP COLUMN IF EXISTS transcript_path,
    DROP COLUMN IF EXISTS transcript_error;

ALTER TABLE forge_settings
    DROP COLUMN IF EXISTS transcript_service_url,
    DROP COLUMN IF EXISTS transcript_service_api_key,
    DROP COLUMN IF EXISTS transcript_model;
""")
