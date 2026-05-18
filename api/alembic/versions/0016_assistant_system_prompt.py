"""Add assistant_system_prompt column to app_settings."""
from alembic import op

revision = '0016'
down_revision = '0015'
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        "ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS assistant_system_prompt TEXT DEFAULT ''"
    )


def downgrade():
    op.execute(
        "ALTER TABLE app_settings DROP COLUMN IF EXISTS assistant_system_prompt"
    )
