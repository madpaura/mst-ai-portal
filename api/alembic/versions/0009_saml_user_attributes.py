"""Add login_id and dept_name_en columns for SAML user attributes."""

from alembic import op

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS login_id TEXT")
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS dept_name_en TEXT")


def downgrade():
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS login_id")
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS dept_name_en")
