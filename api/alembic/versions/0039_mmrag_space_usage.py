"""MMRAG spaces: latest CPU, RAM and disk usage sample."""
from alembic import op

revision = '0039'
down_revision = '0038'
branch_labels = None
depends_on = None


def upgrade():
    op.execute("ALTER TABLE mmrag_spaces ADD COLUMN IF NOT EXISTS usage JSONB")
    op.execute("ALTER TABLE mmrag_spaces ADD COLUMN IF NOT EXISTS usage_checked_at TIMESTAMPTZ")


def downgrade():
    op.execute("ALTER TABLE mmrag_spaces DROP COLUMN IF EXISTS usage_checked_at")
    op.execute("ALTER TABLE mmrag_spaces DROP COLUMN IF EXISTS usage")
