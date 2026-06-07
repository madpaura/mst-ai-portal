"""Ignite browse: featured-series flag, bookmarks, and user playlists."""
from alembic import op

revision = '0022'
down_revision = '0021'
branch_labels = None
depends_on = None


def upgrade():
    # Featured-series flag for the Ignite browse hero
    op.execute("ALTER TABLE courses ADD COLUMN IF NOT EXISTS is_featured BOOLEAN DEFAULT FALSE")

    # Saved / bookmarks
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS video_bookmarks (
            user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
            video_id    UUID REFERENCES videos(id) ON DELETE CASCADE,
            created_at  TIMESTAMPTZ DEFAULT now(),
            PRIMARY KEY (user_id, video_id)
        )
        """
    )
    op.execute("CREATE INDEX IF NOT EXISTS idx_video_bookmarks_user ON video_bookmarks(user_id)")

    # Custom user playlists
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS playlists (
            id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
            name        TEXT NOT NULL,
            created_at  TIMESTAMPTZ DEFAULT now()
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS playlist_videos (
            playlist_id UUID REFERENCES playlists(id) ON DELETE CASCADE,
            video_id    UUID REFERENCES videos(id) ON DELETE CASCADE,
            added_at    TIMESTAMPTZ DEFAULT now(),
            PRIMARY KEY (playlist_id, video_id)
        )
        """
    )
    op.execute("CREATE INDEX IF NOT EXISTS idx_playlists_user ON playlists(user_id)")


def downgrade():
    op.execute("DROP TABLE IF EXISTS playlist_videos")
    op.execute("DROP TABLE IF EXISTS playlists")
    op.execute("DROP TABLE IF EXISTS video_bookmarks")
    op.execute("ALTER TABLE courses DROP COLUMN IF EXISTS is_featured")
