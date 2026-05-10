"""add video_url to forge_components"""
from alembic import op

revision = '0013'
down_revision = '0012'
branch_labels = None
depends_on = None


def upgrade():
    op.execute("ALTER TABLE forge_components ADD COLUMN IF NOT EXISTS video_url TEXT")


def downgrade():
    op.execute("ALTER TABLE forge_components DROP COLUMN IF EXISTS video_url")
