"""Video editor: render job table (issue #260).

Worker-side render pipeline for the editor's non-destructive EDL. Each row
is a single render request: a frozen snapshot of the draft (edits + muted +
style + the requested quality) plus job lifecycle state. `mode` is either
'download' (this slice — renders to a downloadable mp4, portal video is
untouched) or 'apply' (a later slice that re-renders the source in place);
the column exists now so the worker/job-claim plumbing doesn't need another
migration when 'apply' lands.
"""
from alembic import op

revision = '0033'
down_revision = '0032'
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS edit_render_jobs (
            id            BIGSERIAL PRIMARY KEY,
            video_id      UUID NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
            edl           JSONB NOT NULL,
            mode          TEXT NOT NULL DEFAULT 'download'
                          CHECK (mode IN ('download', 'apply')),
            status        TEXT NOT NULL DEFAULT 'queued'
                          CHECK (status IN ('queued', 'processing', 'done', 'error')),
            progress_pct  INTEGER NOT NULL DEFAULT 0,
            output_path   TEXT,
            error         TEXT,
            created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
            started_at    TIMESTAMPTZ,
            completed_at  TIMESTAMPTZ
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_edit_render_jobs_video_id ON edit_render_jobs(video_id)"
    )
    # Worker claim query filters on status = 'queued' ordered by created_at.
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_edit_render_jobs_queued "
        "ON edit_render_jobs(created_at) WHERE status = 'queued'"
    )
    # 409-check query: "is there already an active job for this video?"
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_edit_render_jobs_video_active "
        "ON edit_render_jobs(video_id) WHERE status IN ('queued', 'processing')"
    )


def downgrade():
    op.execute("DROP TABLE IF EXISTS edit_render_jobs")
