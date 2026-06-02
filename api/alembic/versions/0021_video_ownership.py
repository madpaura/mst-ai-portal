"""Add video ownership (created_by) and auto-ready notification tracking."""
from alembic import op

revision = '0021'
down_revision = '0020'
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        "ALTER TABLE videos ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id)"
    )
    op.execute(
        "ALTER TABLE videos ADD COLUMN IF NOT EXISTS auto_ready_notified BOOLEAN DEFAULT FALSE"
    )


def downgrade():
    op.execute("ALTER TABLE videos DROP COLUMN IF EXISTS auto_ready_notified")
    op.execute("ALTER TABLE videos DROP COLUMN IF EXISTS created_by")
