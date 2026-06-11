"""Article likes (thumbs up) — powers the trending sort on the Articles page"""
from alembic import op

revision = '0028'
down_revision = '0027'
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS article_likes (
            user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
            article_id  UUID REFERENCES articles(id) ON DELETE CASCADE,
            created_at  TIMESTAMPTZ DEFAULT now(),
            PRIMARY KEY (user_id, article_id)
        )
        """
    )
    op.execute("CREATE INDEX IF NOT EXISTS idx_article_likes_article ON article_likes(article_id)")


def downgrade():
    op.execute("DROP TABLE IF EXISTS article_likes")
