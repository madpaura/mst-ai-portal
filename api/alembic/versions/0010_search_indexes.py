"""Add pg_trgm extension and GIN full-text search indexes for site-wide search."""

from alembic import op

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")

    # Videos
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_videos_fts ON videos USING GIN (
            to_tsvector('english',
                title || ' ' || COALESCE(description, '') || ' ' || category
            )
        )
    """)

    # Solution cards
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_solution_cards_fts ON solution_cards USING GIN (
            to_tsvector('english',
                title || ' ' || COALESCE(subtitle, '') || ' ' ||
                description || ' ' || COALESCE(long_description, '')
            )
        )
    """)

    # News feed
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_news_feed_fts ON news_feed USING GIN (
            to_tsvector('english',
                title || ' ' || summary || ' ' || COALESCE(content, '')
            )
        )
    """)

    # Courses
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_courses_fts ON courses USING GIN (
            to_tsvector('english',
                title || ' ' || COALESCE(description, '')
            )
        )
    """)


def downgrade():
    op.execute("DROP INDEX IF EXISTS idx_videos_fts")
    op.execute("DROP INDEX IF EXISTS idx_solution_cards_fts")
    op.execute("DROP INDEX IF EXISTS idx_news_feed_fts")
    op.execute("DROP INDEX IF EXISTS idx_courses_fts")
