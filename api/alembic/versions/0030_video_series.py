"""Split Ignite video buckets into Series; courses become curriculum-only
(issue #243).

Creates `video_series` (mirrors the old bucket-course columns), copies every
`courses` row into it (including curriculum courses, so their videos stay
browsable in Ignite), backfills `videos.series_id` from `videos.course_id`
and drops `course_id`, then deletes bucket-only rows from `courses` (no
modules and not curriculum-published) — their enrollment/analytics rows
cascade away, since series-level enrollment is removed as a feature.
"""
from alembic import op

revision = '0030'
down_revision = '0029'
branch_labels = None
depends_on = None


def upgrade():
    # ── video_series: Ignite's browse buckets, split out of courses ──
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS video_series (
            id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            title       TEXT NOT NULL,
            slug        TEXT UNIQUE NOT NULL,
            description TEXT,
            is_active   BOOLEAN DEFAULT true,
            is_featured BOOLEAN DEFAULT false,
            sort_order  INTEGER DEFAULT 0,
            created_at  TIMESTAMPTZ DEFAULT now()
        )
        """
    )

    # Copy every courses row into video_series with matching ids (twins for
    # curriculum courses too, so their videos stay browsable in Ignite).
    op.execute(
        """
        INSERT INTO video_series (id, title, slug, description, is_active, is_featured, sort_order, created_at)
        SELECT id, title, slug, description, is_active, is_featured, sort_order, created_at
        FROM courses
        ON CONFLICT (id) DO NOTHING
        """
    )

    # ── videos.series_id replaces videos.course_id ──
    op.execute(
        "ALTER TABLE videos ADD COLUMN IF NOT EXISTS series_id UUID REFERENCES video_series(id) ON DELETE SET NULL"
    )
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'videos' AND column_name = 'course_id'
            ) THEN
                UPDATE videos SET series_id = course_id
                WHERE series_id IS NULL AND course_id IS NOT NULL;
            END IF;
        END $$;
        """
    )
    op.execute("CREATE INDEX IF NOT EXISTS idx_videos_series_id ON videos(series_id)")
    op.execute("ALTER TABLE videos DROP COLUMN IF EXISTS course_id")

    # ── courses becomes curriculum-only: drop bucket-only rows (no modules,
    #    not curriculum-published). Enrollment/analytics rows for them cascade
    #    away (FK ON DELETE CASCADE) — series-level enrollment is removed as
    #    a feature, so this is intended, not a data-loss bug.
    op.execute(
        """
        DELETE FROM courses c
        WHERE curriculum_published IS NOT TRUE
          AND NOT EXISTS (SELECT 1 FROM course_modules m WHERE m.course_id = c.id)
        """
    )


def downgrade():
    # Best-effort: restore videos.course_id from series_id (for series that
    # still map to a surviving courses row), then drop video_series.
    # Bucket-only courses rows deleted in upgrade() are not recoverable.
    op.execute(
        "ALTER TABLE videos ADD COLUMN IF NOT EXISTS course_id UUID REFERENCES courses(id) ON DELETE SET NULL"
    )
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'videos' AND column_name = 'series_id'
            ) THEN
                UPDATE videos SET course_id = series_id
                WHERE course_id IS NULL AND series_id IS NOT NULL
                  AND series_id IN (SELECT id FROM courses);
            END IF;
        END $$;
        """
    )
    op.execute("CREATE INDEX IF NOT EXISTS idx_videos_course ON videos(course_id)")
    op.execute("ALTER TABLE videos DROP COLUMN IF EXISTS series_id")
    op.execute("DROP TABLE IF EXISTS video_series")
