"""Missing FK / hot-path indexes (per-video page queries, course joins, page_views stats)"""
from alembic import op

revision = '0027'
down_revision = '0026'
branch_labels = None
depends_on = None

_INDEXES = [
    ("idx_video_chapters_video", "video_chapters (video_id)"),
    ("idx_howto_guides_video", "howto_guides (video_id)"),
    ("idx_user_notes_user_video", "user_notes (user_id, video_id)"),
    ("idx_seed_notes_video", "seed_notes (video_id)"),
    ("idx_videos_course", "videos (course_id)"),
    ("idx_user_video_progress_video", "user_video_progress (video_id)"),
    ("idx_sessions_user", "sessions (user_id)"),
    # /video/videos/stats: WHERE section = 'ignite' AND path LIKE ... GROUP BY path
    ("idx_page_views_section_path", "page_views (section, path)"),
]


def upgrade():
    for name, spec in _INDEXES:
        op.execute(f"CREATE INDEX IF NOT EXISTS {name} ON {spec}")


def downgrade():
    for name, _ in _INDEXES:
        op.execute(f"DROP INDEX IF EXISTS {name}")
