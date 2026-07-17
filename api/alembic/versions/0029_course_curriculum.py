"""Course curriculum (issue #239): weekly modules, items, per-item progress,
course feedback, and authored course metadata for the Courses section."""
from alembic import op

revision = '0029'
down_revision = '0028'
branch_labels = None
depends_on = None


def upgrade():
    # ── authored course metadata + curriculum publish gate ──
    op.execute("ALTER TABLE courses ADD COLUMN IF NOT EXISTS level TEXT")
    op.execute("ALTER TABLE courses ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}'")
    op.execute("ALTER TABLE courses ADD COLUMN IF NOT EXISTS cover_image TEXT")
    op.execute("ALTER TABLE courses ADD COLUMN IF NOT EXISTS objectives TEXT[] DEFAULT '{}'")
    op.execute("ALTER TABLE courses ADD COLUMN IF NOT EXISTS prerequisites TEXT")
    op.execute("ALTER TABLE courses ADD COLUMN IF NOT EXISTS curriculum_published BOOLEAN DEFAULT false")

    # ── weekly modules ──
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS course_modules (
            id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            course_id   UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
            week_number INTEGER NOT NULL DEFAULT 1,
            title       TEXT NOT NULL,
            summary     TEXT,
            sort_order  INTEGER DEFAULT 0,
            created_at  TIMESTAMPTZ DEFAULT now()
        )
        """
    )
    op.execute("CREATE INDEX IF NOT EXISTS idx_course_modules_course ON course_modules(course_id)")

    # ── curriculum items ──
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS course_items (
            id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            module_id    UUID NOT NULL REFERENCES course_modules(id) ON DELETE CASCADE,
            item_type    TEXT NOT NULL CHECK (item_type IN ('video', 'exercise', 'reading', 'link')),
            title        TEXT NOT NULL,
            description  TEXT,
            duration_min INTEGER DEFAULT 0,
            video_id     UUID REFERENCES videos(id) ON DELETE SET NULL,
            external_url TEXT,
            links        JSONB DEFAULT '[]',
            sort_order   INTEGER DEFAULT 0,
            created_at   TIMESTAMPTZ DEFAULT now()
        )
        """
    )
    op.execute("CREATE INDEX IF NOT EXISTS idx_course_items_module ON course_items(module_id)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_course_items_video ON course_items(video_id)")

    # ── per-item progress (manual ticks; video items merge with
    #    user_video_progress at read time) ──
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS user_item_progress (
            user_id      UUID REFERENCES users(id) ON DELETE CASCADE,
            item_id      UUID REFERENCES course_items(id) ON DELETE CASCADE,
            completed    BOOLEAN DEFAULT true,
            completed_at TIMESTAMPTZ DEFAULT now(),
            PRIMARY KEY (user_id, item_id)
        )
        """
    )
    op.execute("CREATE INDEX IF NOT EXISTS idx_user_item_progress_item ON user_item_progress(item_id)")

    # ── course feedback: one editable rating+comment per user per course ──
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS course_feedback (
            user_id    UUID REFERENCES users(id) ON DELETE CASCADE,
            course_id  UUID REFERENCES courses(id) ON DELETE CASCADE,
            rating     INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
            comment    TEXT,
            created_at TIMESTAMPTZ DEFAULT now(),
            updated_at TIMESTAMPTZ DEFAULT now(),
            PRIMARY KEY (user_id, course_id)
        )
        """
    )
    op.execute("CREATE INDEX IF NOT EXISTS idx_course_feedback_course ON course_feedback(course_id)")


def downgrade():
    op.execute("DROP TABLE IF EXISTS course_feedback")
    op.execute("DROP TABLE IF EXISTS user_item_progress")
    op.execute("DROP TABLE IF EXISTS course_items")
    op.execute("DROP TABLE IF EXISTS course_modules")
    op.execute("ALTER TABLE courses DROP COLUMN IF EXISTS curriculum_published")
    op.execute("ALTER TABLE courses DROP COLUMN IF EXISTS prerequisites")
    op.execute("ALTER TABLE courses DROP COLUMN IF EXISTS objectives")
    op.execute("ALTER TABLE courses DROP COLUMN IF EXISTS cover_image")
    op.execute("ALTER TABLE courses DROP COLUMN IF EXISTS tags")
    op.execute("ALTER TABLE courses DROP COLUMN IF EXISTS level")
