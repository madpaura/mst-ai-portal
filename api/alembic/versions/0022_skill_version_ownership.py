"""skill version ownership — creator_user_id on forge_components, parent_slug+version_tag on artifact_submissions"""
from alembic import op

revision = '0022'
down_revision = '0021'
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
ALTER TABLE forge_components
    ADD COLUMN IF NOT EXISTS creator_user_id UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_forge_components_creator ON forge_components (creator_user_id);

ALTER TABLE artifact_submissions
    ADD COLUMN IF NOT EXISTS parent_slug TEXT,
    ADD COLUMN IF NOT EXISTS version_tag TEXT;
""")


def downgrade():
    op.execute("""
DROP INDEX IF EXISTS idx_forge_components_creator;
ALTER TABLE forge_components DROP COLUMN IF EXISTS creator_user_id;
ALTER TABLE artifact_submissions DROP COLUMN IF EXISTS parent_slug;
ALTER TABLE artifact_submissions DROP COLUMN IF EXISTS version_tag;
""")
