"""fix videos status constraint — add 'draft', update default

Revision ID: 0003
Revises: 0002
Create Date: 2026-05-01
"""

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from alembic import op

    op.execute("""
-- Drop the old constraint (auto-named by Postgres from the inline CHECK)
ALTER TABLE videos DROP CONSTRAINT IF EXISTS videos_status_check;

-- Add corrected constraint that includes 'draft'
ALTER TABLE videos
    ADD CONSTRAINT videos_status_check
    CHECK (status IN ('draft', 'processing', 'uploaded', 'ready', 'error'));

-- Change default from 'processing' to 'draft' to match the insert pattern
ALTER TABLE videos ALTER COLUMN status SET DEFAULT 'draft';
""")


def downgrade() -> None:
    from alembic import op

    op.execute("""
ALTER TABLE videos DROP CONSTRAINT IF EXISTS videos_status_check;
ALTER TABLE videos
    ADD CONSTRAINT videos_status_check
    CHECK (status IN ('processing', 'ready', 'error', 'uploaded'));
ALTER TABLE videos ALTER COLUMN status SET DEFAULT 'processing';
""")
