"""Add pg_trgm GIN indexes on title/name columns and fix FTS expression mismatches."""

revision = "0019"
down_revision = "0018"

from alembic import op


def upgrade():
    # Trigram GIN indexes for word_similarity() — these make fuzzy search use index instead of seq scan
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_videos_title_trgm
        ON videos USING gin (title gin_trgm_ops)
        WHERE is_published = true AND is_active = true
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_articles_title_trgm
        ON articles USING gin (title gin_trgm_ops)
        WHERE is_published = true AND is_active = true
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_solution_cards_title_trgm
        ON solution_cards USING gin (title gin_trgm_ops)
        WHERE is_active = true
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_news_feed_title_trgm
        ON news_feed USING gin (title gin_trgm_ops)
        WHERE is_active = true
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_forge_name_trgm
        ON forge_components USING gin (name gin_trgm_ops)
        WHERE is_active = true
    """)

    # Fix FTS index for forge_components — existing idx_forge_search excludes component_type,
    # so search queries that include it fall back to seq scan. Drop old and add matching one.
    op.execute("DROP INDEX IF EXISTS idx_forge_search")
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_forge_fts
        ON forge_components USING gin (
            to_tsvector('english', name || ' ' || COALESCE(description, '') || ' ' || component_type)
        )
    """)

    # Fix FTS index for solution_cards — existing index includes long_description but queries don't,
    # causing expression mismatch. Drop old and add one that matches the query expressions.
    op.execute("DROP INDEX IF EXISTS idx_solution_cards_fts")
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_solution_cards_fts
        ON solution_cards USING gin (
            to_tsvector('english', title || ' ' || COALESCE(subtitle, '') || ' ' || COALESCE(description, ''))
        )
    """)


def downgrade():
    op.execute("DROP INDEX IF EXISTS idx_videos_title_trgm")
    op.execute("DROP INDEX IF EXISTS idx_articles_title_trgm")
    op.execute("DROP INDEX IF EXISTS idx_solution_cards_title_trgm")
    op.execute("DROP INDEX IF EXISTS idx_news_feed_title_trgm")
    op.execute("DROP INDEX IF EXISTS idx_forge_name_trgm")
    op.execute("DROP INDEX IF EXISTS idx_forge_fts")
    op.execute("DROP INDEX IF EXISTS idx_solution_cards_fts")
