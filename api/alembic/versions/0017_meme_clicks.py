"""Create meme_clicks table for meme email click tracking."""
from alembic import op

revision = '0017'
down_revision = '0016'
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        CREATE TABLE IF NOT EXISTS meme_clicks (
            id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            meme_id     UUID NOT NULL REFERENCES memes(id) ON DELETE CASCADE,
            clicked_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            user_id     UUID,
            ip_address  TEXT,
            user_agent  TEXT,
            referrer    TEXT
        )
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_meme_clicks_meme_clicked
            ON meme_clicks (meme_id, clicked_at)
    """)


def downgrade():
    op.execute("DROP INDEX IF EXISTS idx_meme_clicks_meme_clicked")
    op.execute("DROP TABLE IF EXISTS meme_clicks")
