"""Video editor: cancellable render jobs.

Adds 'cancelled' as a valid edit_render_jobs.status so both the export
(mode='download') and apply (mode='apply') render flows can be cancelled
from the export/apply modal — previously the only way out of a running
render was to wait for ffmpeg to finish or kill the worker. The cancel
endpoint sets this status directly; the worker notices on its ~1s poll and
terminates the in-flight ffmpeg process (see process_render_job in
worker/transcoder.py).
"""
from alembic import op

revision = '0035'
down_revision = '0034'
branch_labels = None
depends_on = None


def upgrade():
    op.execute("ALTER TABLE edit_render_jobs DROP CONSTRAINT IF EXISTS edit_render_jobs_status_check")
    op.execute(
        "ALTER TABLE edit_render_jobs ADD CONSTRAINT edit_render_jobs_status_check "
        "CHECK (status IN ('queued', 'processing', 'done', 'error', 'cancelled'))"
    )


def downgrade():
    op.execute("ALTER TABLE edit_render_jobs DROP CONSTRAINT IF EXISTS edit_render_jobs_status_check")
    op.execute(
        "ALTER TABLE edit_render_jobs ADD CONSTRAINT edit_render_jobs_status_check "
        "CHECK (status IN ('queued', 'processing', 'done', 'error'))"
    )
