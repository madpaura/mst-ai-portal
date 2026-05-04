"""article_attachments table

Revision ID: 0006
Revises: 0005
Create Date: 2026-05-04
"""
from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        CREATE TABLE IF NOT EXISTS article_attachments (
            id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            article_id  UUID NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
            filename    TEXT NOT NULL,
            file_path   TEXT NOT NULL,
            file_size   BIGINT NOT NULL DEFAULT 0,
            mime_type   TEXT NOT NULL DEFAULT '',
            created_at  TIMESTAMPTZ DEFAULT now()
        )
    """)
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_article_attachments_article ON article_attachments(article_id)"
    )


def downgrade():
    op.execute("DROP TABLE IF EXISTS article_attachments")
