"""add memes tables

Revision ID: 0008
Revises: 0007
Create Date: 2026-05-06
"""
from alembic import op

revision = '0008'
down_revision = '0007'
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        CREATE TABLE IF NOT EXISTS meme_groups (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            title TEXT NOT NULL,
            slug TEXT NOT NULL UNIQUE,
            category TEXT NOT NULL DEFAULT 'General',
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)
    op.execute("""
        CREATE TABLE IF NOT EXISTS memes (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            group_id UUID NOT NULL REFERENCES meme_groups(id) ON DELETE CASCADE,
            title TEXT,
            image_url TEXT NOT NULL,
            link_url TEXT,
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS idx_memes_group_id ON memes(group_id)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_meme_groups_category ON meme_groups(category)")


def downgrade():
    op.execute("DROP TABLE IF EXISTS memes")
    op.execute("DROP TABLE IF EXISTS meme_groups")
