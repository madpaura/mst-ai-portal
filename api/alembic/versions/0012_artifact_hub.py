"""artifact hub — submissions table for agents, skills, and MCPs"""
from alembic import op

revision = '0012'
down_revision = '0011'
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
CREATE TABLE IF NOT EXISTS artifact_submissions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL,
    display_name    TEXT NOT NULL,
    artifact_type   TEXT NOT NULL CHECK (artifact_type IN ('agent', 'skill', 'mcp')),
    description     TEXT,
    instructions    TEXT,
    files           JSONB NOT NULL DEFAULT '[]',
    tags            TEXT[] DEFAULT '{}',
    status          TEXT NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'pending', 'approved', 'published', 'rejected')),
    validation_results JSONB,
    submitted_by    UUID REFERENCES users(id) ON DELETE SET NULL,
    reviewed_by     UUID REFERENCES users(id) ON DELETE SET NULL,
    github_url      TEXT,
    reject_reason   TEXT,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_artifact_submissions_type   ON artifact_submissions (artifact_type);
CREATE INDEX IF NOT EXISTS idx_artifact_submissions_status ON artifact_submissions (status);
CREATE INDEX IF NOT EXISTS idx_artifact_submissions_author ON artifact_submissions (submitted_by);
""")


def downgrade():
    op.execute("DROP TABLE IF EXISTS artifact_submissions")
