"""add contact_entries table

Revision ID: 0007
Revises: 0006
Create Date: 2026-05-05
"""
from alembic import op

revision = '0007'
down_revision = '0006'
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        CREATE TABLE IF NOT EXISTS contact_entries (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            division TEXT NOT NULL,
            name TEXT NOT NULL,
            title TEXT NOT NULL DEFAULT '',
            email TEXT NOT NULL,
            is_active BOOLEAN NOT NULL DEFAULT true,
            sort_order INT NOT NULL DEFAULT 0,
            created_at TIMESTAMPTZ DEFAULT now()
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS idx_contact_entries_division ON contact_entries(division)")


def downgrade():
    op.execute("DROP TABLE IF EXISTS contact_entries")
