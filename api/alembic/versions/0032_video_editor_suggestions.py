"""Video editor: silence-gap suggestions storage (issue #259).

Adds a `suggestions` JSONB column to video_editor_drafts holding the last
computed set of skip suggestions (currently just deterministic transcript-gap
suggestions; a follow-up slice adds an LLM-sourced kind onto the same shape).
Each element carries an `id` (deterministic hash of its rounded start/end so
re-analysis produces stable ids), `kind`, `start_s`/`end_s`, and a `state`
(open/accepted/ignored) — persisting accepted/ignored state here is what lets
re-analyze avoid resurrecting suggestions the user already reviewed.
"""
from alembic import op

revision = '0032'
down_revision = '0031'
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        "ALTER TABLE video_editor_drafts ADD COLUMN IF NOT EXISTS suggestions JSONB NOT NULL DEFAULT '[]'"
    )


def downgrade():
    op.execute("ALTER TABLE video_editor_drafts DROP COLUMN IF EXISTS suggestions")
