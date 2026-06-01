"""Add assistant_enabled column to app_settings."""
from alembic import op

revision = '0020'
down_revision = '0019'
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        "ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS assistant_enabled BOOLEAN DEFAULT TRUE"
    )


def downgrade():
    op.execute(
        "ALTER TABLE app_settings DROP COLUMN IF EXISTS assistant_enabled"
    )
