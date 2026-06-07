"""forge_components.source_hash — detect README changes to avoid re-running the About LLM each sync"""
from alembic import op

revision = '0025'
down_revision = '0024'
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        "ALTER TABLE forge_components ADD COLUMN IF NOT EXISTS source_hash TEXT"
    )


def downgrade():
    op.execute(
        "ALTER TABLE forge_components DROP COLUMN IF EXISTS source_hash"
    )
