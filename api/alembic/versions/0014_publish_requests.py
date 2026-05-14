"""add publish_requests table"""
from alembic import op

revision = '0014'
down_revision = '0013'
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        CREATE TABLE IF NOT EXISTS publish_requests (
            id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            target_type TEXT NOT NULL,
            target_id   UUID NOT NULL,
            target_title TEXT,
            requested_by UUID NOT NULL,
            requester_name TEXT,
            requester_email TEXT,
            status      TEXT NOT NULL DEFAULT 'pending',
            note        TEXT,
            created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
            reviewed_at TIMESTAMPTZ,
            reviewed_by UUID,
            reviewer_name TEXT
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS idx_publish_requests_status ON publish_requests(status)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_publish_requests_target ON publish_requests(target_type, target_id)")


def downgrade():
    op.execute("DROP TABLE IF EXISTS publish_requests")
