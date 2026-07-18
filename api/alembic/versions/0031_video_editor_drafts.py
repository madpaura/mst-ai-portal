"""Video editor: EDL draft storage (issue #256).

One autosaved, non-destructive edit-list draft per video: an ordered list of
cut/trim/speed operations plus mute/style state. Nothing here touches the
raw file — a later slice renders the draft into the actual video.
"""
from alembic import op

revision = '0031'
down_revision = '0030'
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS video_editor_drafts (
            id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            video_id    UUID NOT NULL UNIQUE REFERENCES videos(id) ON DELETE CASCADE,
            edits       JSONB NOT NULL DEFAULT '[]',
            muted       BOOLEAN NOT NULL DEFAULT false,
            style       JSONB NOT NULL DEFAULT '{"preset": "none", "pad_pct": 0, "radius_px": 0}',
            updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_video_editor_drafts_video_id ON video_editor_drafts(video_id)"
    )


def downgrade():
    op.execute("DROP TABLE IF EXISTS video_editor_drafts")
