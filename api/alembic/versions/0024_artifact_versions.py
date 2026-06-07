"""artifact version history snapshots + semantic version bump on submissions"""
from alembic import op

revision = '0024'
down_revision = '0023'
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
CREATE TABLE IF NOT EXISTS artifact_versions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    submission_id   UUID REFERENCES artifact_submissions(id) ON DELETE SET NULL,
    name            TEXT NOT NULL,
    artifact_type   TEXT NOT NULL,
    version         TEXT NOT NULL,
    description     TEXT,
    instructions    TEXT,
    files           JSONB NOT NULL DEFAULT '[]',
    tags            TEXT[] DEFAULT '{}',
    github_url      TEXT,
    published_by    UUID REFERENCES users(id) ON DELETE SET NULL,
    published_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_artifact_versions_lineage    ON artifact_versions (name, artifact_type);
CREATE INDEX IF NOT EXISTS idx_artifact_versions_submission ON artifact_versions (submission_id);

ALTER TABLE artifact_submissions ADD COLUMN IF NOT EXISTS version_bump TEXT;
""")


def downgrade():
    op.execute("""
DROP TABLE IF EXISTS artifact_versions;
ALTER TABLE artifact_submissions DROP COLUMN IF EXISTS version_bump;
""")
