"""add missing indexes on foreign key and hot-query columns"""
from alembic import op

revision = '0015'
down_revision = '0014'
branch_labels = None
depends_on = None


def upgrade():
    # forge_install_events FK columns (no indexes existed)
    op.execute("CREATE INDEX IF NOT EXISTS idx_forge_install_component_id ON forge_install_events (component_id)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_forge_install_user_id ON forge_install_events (user_id)")
    # page_views: user_id FK was missing
    op.execute("CREATE INDEX IF NOT EXISTS idx_page_views_user_id ON page_views (user_id)")
    # analytics_events: user_id FK was missing
    op.execute("CREATE INDEX IF NOT EXISTS idx_analytics_events_user_id ON analytics_events (user_id)")
    # user_video_progress: composite index for UPSERT and progress lookups
    op.execute("CREATE INDEX IF NOT EXISTS idx_user_video_progress_user_video ON user_video_progress (user_id, video_id)")
    # transcode_jobs: composite index for video + status filter used in admin queries
    op.execute("CREATE INDEX IF NOT EXISTS idx_transcode_jobs_video_status ON transcode_jobs (video_id, status)")


def downgrade():
    op.execute("DROP INDEX IF EXISTS idx_forge_install_component_id")
    op.execute("DROP INDEX IF EXISTS idx_forge_install_user_id")
    op.execute("DROP INDEX IF EXISTS idx_page_views_user_id")
    op.execute("DROP INDEX IF EXISTS idx_analytics_events_user_id")
    op.execute("DROP INDEX IF EXISTS idx_user_video_progress_user_video")
    op.execute("DROP INDEX IF EXISTS idx_transcode_jobs_video_status")
