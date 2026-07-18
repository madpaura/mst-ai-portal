"""Video editor: apply-to-video stale tracking (issue #261).

The 'apply' render mode (mode='apply' on edit_render_jobs, added by #260)
re-renders the EDL in place over raw/original.mp4. Because cuts/speed edits
shift downstream timestamps, a successful apply can leave an existing
transcript/captions/chapters out of sync with the new file. Rather than
regenerating them silently (hand-edited chapters must survive unless the
user opts in), we flag the video and let the editor / video admin screen
prompt for an explicit regenerate.

`editor_applied_at` records when the raw file was last replaced via apply —
informational, and lets the UI show "edited Nm ago". `pipeline_stale` is the
actual prompt trigger, set true only when a transcript/chapters existed at
apply time (nothing to regenerate otherwise) and cleared either by accepting
the regenerate prompt or dismissed ("Later") which just collapses the UI
without clearing the flag.
"""
from alembic import op

revision = '0034'
down_revision = '0033'
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        "ALTER TABLE videos ADD COLUMN IF NOT EXISTS editor_applied_at TIMESTAMPTZ"
    )
    op.execute(
        "ALTER TABLE videos ADD COLUMN IF NOT EXISTS pipeline_stale BOOLEAN NOT NULL DEFAULT false"
    )


def downgrade():
    op.execute("ALTER TABLE videos DROP COLUMN IF EXISTS pipeline_stale")
    op.execute("ALTER TABLE videos DROP COLUMN IF EXISTS editor_applied_at")
