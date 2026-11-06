"""Allow 'cancelled' on transcode_jobs in databases created from db/init.sql.

The baseline allows it, but init.sql created the table without it first, so the
baseline's CREATE TABLE IF NOT EXISTS changed nothing. In those databases the
admin cancel-job endpoint and the worker's shutdown cleanup fail on the check.
"""
from alembic import op

revision = '0037'
down_revision = '0036'
branch_labels = None
depends_on = None


def upgrade():
    op.execute("ALTER TABLE transcode_jobs DROP CONSTRAINT IF EXISTS transcode_jobs_status_check")
    op.execute(
        "ALTER TABLE transcode_jobs ADD CONSTRAINT transcode_jobs_status_check "
        "CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled'))"
    )


def downgrade():
    # The baseline already allows 'cancelled', and rows may now hold it.
    pass
