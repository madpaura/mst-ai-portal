"""add howto_guide_url to forge_components"""
from alembic import op

revision = '0011'
down_revision = '0010'
branch_labels = None
depends_on = None


def upgrade():
    op.execute("ALTER TABLE forge_components ADD COLUMN IF NOT EXISTS howto_guide_url TEXT")


def downgrade():
    op.execute("ALTER TABLE forge_components DROP COLUMN IF EXISTS howto_guide_url")
