"""baseline — full schema as of migration 016

Revision ID: 0001
Revises:
Create Date: 2026-04-22
"""

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    from alembic import op

    op.execute("""
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username        TEXT UNIQUE NOT NULL,
    email           TEXT UNIQUE,
    display_name    TEXT NOT NULL,
    initials        TEXT,
    password_hash   TEXT,
    role            TEXT DEFAULT 'user' CHECK (role IN ('user', 'content', 'admin')),
    employee_id     TEXT,
    auth_provider   TEXT DEFAULT 'local' CHECK (auth_provider IN ('local', 'saml', 'ldap')),
    saml_name_id    TEXT,
    last_login      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_users_saml_name_id ON users (saml_name_id) WHERE saml_name_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS sessions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
    token_hash  TEXT NOT NULL,
    expires_at  TIMESTAMPTZ NOT NULL,
    created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS courses (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title       TEXT NOT NULL,
    slug        TEXT UNIQUE NOT NULL,
    description TEXT,
    is_active   BOOLEAN DEFAULT true,
    sort_order  INTEGER DEFAULT 0,
    created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS videos (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id       UUID REFERENCES courses(id) ON DELETE SET NULL,
    title           TEXT NOT NULL,
    slug            TEXT UNIQUE NOT NULL,
    description     TEXT,
    category        TEXT NOT NULL,
    duration_s      INTEGER,
    status          TEXT DEFAULT 'processing'
                    CHECK (status IN ('processing', 'ready', 'error', 'uploaded')),
    hls_path        TEXT,
    thumbnail       TEXT,
    custom_thumbnail TEXT,
    is_published    BOOLEAN DEFAULT false,
    is_active       BOOLEAN DEFAULT true,
    sort_order      INTEGER DEFAULT 0,
    created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS video_chapters (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    video_id    UUID REFERENCES videos(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    start_time  INTEGER NOT NULL,
    sort_order  INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS video_quality_settings (
    video_id    UUID REFERENCES videos(id) ON DELETE CASCADE,
    quality     TEXT NOT NULL CHECK (quality IN ('360p', '720p', '1080p')),
    enabled     BOOLEAN DEFAULT true,
    crf         INTEGER DEFAULT 23,
    PRIMARY KEY (video_id, quality)
);

CREATE TABLE IF NOT EXISTS user_video_progress (
    user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
    video_id        UUID REFERENCES videos(id) ON DELETE CASCADE,
    watched_seconds INTEGER DEFAULT 0,
    completed       BOOLEAN DEFAULT false,
    last_position   INTEGER DEFAULT 0,
    updated_at      TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (user_id, video_id)
);

CREATE TABLE IF NOT EXISTS user_notes (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
    video_id    UUID REFERENCES videos(id) ON DELETE CASCADE,
    timestamp_s INTEGER NOT NULL,
    content     TEXT NOT NULL,
    screenshot  TEXT,
    created_at  TIMESTAMPTZ DEFAULT now(),
    updated_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS seed_notes (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    video_id    UUID REFERENCES videos(id) ON DELETE CASCADE,
    timestamp_s INTEGER NOT NULL,
    content     TEXT NOT NULL,
    created_by  UUID REFERENCES users(id),
    created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS howto_guides (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    video_id    UUID REFERENCES videos(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    content     TEXT NOT NULL,
    version     TEXT DEFAULT '1.0',
    created_at  TIMESTAMPTZ DEFAULT now(),
    updated_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS video_banners (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    video_id          UUID REFERENCES videos(id) ON DELETE CASCADE UNIQUE,
    variant           TEXT NOT NULL DEFAULT 'A' CHECK (variant IN ('A', 'B', 'C')),
    company_logo      TEXT NOT NULL DEFAULT 'SAMSUNG',
    series_tag        TEXT NOT NULL DEFAULT 'KNOWLEDGE SERIES',
    topic             TEXT NOT NULL DEFAULT 'Intro to AI Agents',
    subtopic          TEXT NOT NULL DEFAULT 'Environment Setup & First Run',
    episode           TEXT NOT NULL DEFAULT 'EP 01',
    duration          TEXT NOT NULL DEFAULT '3:15',
    presenter         TEXT NOT NULL DEFAULT 'Vishwa',
    presenter_initial TEXT NOT NULL DEFAULT 'V',
    banner_duration_s INTEGER NOT NULL DEFAULT 3 CHECK (banner_duration_s >= 3 AND banner_duration_s <= 10),
    status            TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'generating', 'ready', 'error')),
    brand_title       TEXT NOT NULL DEFAULT 'AI Ignite',
    banner_video_path TEXT,
    error             TEXT,
    created_at        TIMESTAMPTZ DEFAULT now(),
    updated_at        TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS transcode_jobs (
    id              BIGSERIAL PRIMARY KEY,
    video_id        UUID REFERENCES videos(id) ON DELETE CASCADE,
    status          TEXT DEFAULT 'pending'
                    CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled')),
    attempts        INTEGER DEFAULT 0,
    max_attempts    INTEGER DEFAULT 3,
    error           TEXT,
    started_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_jobs_pending ON transcode_jobs(status) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS forge_components (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug            TEXT UNIQUE NOT NULL,
    name            TEXT NOT NULL,
    component_type  TEXT NOT NULL CHECK (component_type IN ('agent', 'skill', 'mcp_server')),
    description     TEXT,
    long_description TEXT,
    icon            TEXT,
    icon_color      TEXT,
    version         TEXT NOT NULL,
    install_command TEXT NOT NULL,
    badge           TEXT CHECK (badge IN ('verified', 'community', 'open_source', NULL)),
    author          TEXT,
    downloads       INTEGER DEFAULT 0,
    tags            TEXT[] DEFAULT '{}',
    is_active       BOOLEAN DEFAULT true,
    git_repo_url    TEXT,
    git_ref         TEXT,
    last_synced_at  TIMESTAMPTZ,
    howto_guide     TEXT,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_forge_type ON forge_components(component_type);
CREATE INDEX IF NOT EXISTS idx_forge_tags ON forge_components USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_forge_search ON forge_components USING GIN(
    to_tsvector('english', name || ' ' || COALESCE(description, ''))
);

CREATE TABLE IF NOT EXISTS forge_install_events (
    id              BIGSERIAL PRIMARY KEY,
    component_id    UUID REFERENCES forge_components(id) ON DELETE CASCADE,
    user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
    installed_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS capabilities (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    icon        TEXT NOT NULL,
    title       TEXT NOT NULL,
    description TEXT NOT NULL,
    sort_order  INTEGER DEFAULT 0,
    is_active   BOOLEAN DEFAULT true
);

CREATE TABLE IF NOT EXISTS announcements (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title       TEXT NOT NULL,
    content     TEXT,
    badge       TEXT,
    is_active   BOOLEAN DEFAULT true,
    created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS contact_submissions (
    id          BIGSERIAL PRIMARY KEY,
    name        TEXT NOT NULL,
    email       TEXT NOT NULL,
    message     TEXT NOT NULL,
    created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS forge_settings (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    git_url         TEXT NOT NULL,
    git_token       TEXT,
    git_branch      TEXT DEFAULT 'main',
    scan_paths      TEXT[] DEFAULT '{"."}',
    update_frequency TEXT DEFAULT 'nightly'
                    CHECK (update_frequency IN ('hourly', 'nightly', 'weekly', 'manual')),
    llm_provider    TEXT DEFAULT 'openai',
    llm_model       TEXT DEFAULT 'gpt-4o-mini',
    llm_api_key     TEXT,
    auto_update_release_tag BOOLEAN DEFAULT true,
    is_active       BOOLEAN DEFAULT true,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS forge_sync_jobs (
    id                  BIGSERIAL PRIMARY KEY,
    settings_id         UUID REFERENCES forge_settings(id) ON DELETE CASCADE,
    trigger_type        TEXT NOT NULL DEFAULT 'manual'
                        CHECK (trigger_type IN ('manual', 'scheduled', 'nightly')),
    status              TEXT DEFAULT 'pending'
                        CHECK (status IN ('pending', 'running', 'completed', 'failed')),
    components_found    INTEGER DEFAULT 0,
    components_updated  INTEGER DEFAULT 0,
    components_created  INTEGER DEFAULT 0,
    error               TEXT,
    log                 TEXT DEFAULT '',
    started_at          TIMESTAMPTZ,
    completed_at        TIMESTAMPTZ,
    created_at          TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS solution_cards (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title           TEXT NOT NULL,
    subtitle        TEXT,
    description     TEXT NOT NULL,
    long_description TEXT,
    icon            TEXT DEFAULT 'smart_toy',
    icon_color      TEXT DEFAULT 'text-primary',
    badge           TEXT,
    link_url        TEXT,
    launch_url      TEXT,
    sort_order      INTEGER DEFAULT 0,
    is_active       BOOLEAN DEFAULT true,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS guest_interests (
    id          BIGSERIAL PRIMARY KEY,
    email       TEXT NOT NULL,
    source      TEXT DEFAULT 'contribute',
    status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'contacted', 'dismissed')),
    admin_note  TEXT,
    reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMPTZ,
    created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_guest_interests_status ON guest_interests (status);

CREATE TABLE IF NOT EXISTS news_feed (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title           TEXT NOT NULL,
    summary         TEXT NOT NULL,
    content         TEXT,
    source          TEXT DEFAULT 'manual'
                    CHECK (source IN ('manual', 'rss', 'release', 'llm')),
    source_url      TEXT,
    badge           TEXT,
    is_active       BOOLEAN DEFAULT true,
    published_at    TIMESTAMPTZ DEFAULT now(),
    created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS news_rss_feeds (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL,
    feed_url        TEXT NOT NULL UNIQUE,
    badge           TEXT DEFAULT 'RSS',
    is_active       BOOLEAN DEFAULT true,
    last_fetched_at TIMESTAMPTZ,
    items_imported  INTEGER DEFAULT 0,
    error           TEXT,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS video_likes (
    user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
    video_id    UUID REFERENCES videos(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (user_id, video_id)
);

CREATE INDEX IF NOT EXISTS idx_video_likes_video ON video_likes(video_id);

CREATE TABLE IF NOT EXISTS page_views (
    id          BIGSERIAL PRIMARY KEY,
    path        TEXT NOT NULL,
    section     TEXT NOT NULL CHECK (section IN ('solutions', 'marketplace', 'ignite', 'news', 'articles', 'other')),
    ip_address  TEXT,
    user_agent  TEXT,
    user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
    referrer    TEXT,
    created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_page_views_section ON page_views(section);
CREATE INDEX IF NOT EXISTS idx_page_views_created ON page_views(created_at);
CREATE INDEX IF NOT EXISTS idx_page_views_path ON page_views(path);

CREATE TABLE IF NOT EXISTS analytics_events (
    id          BIGSERIAL PRIMARY KEY,
    event_type  TEXT NOT NULL,
    section     TEXT NOT NULL,
    entity_id   TEXT,
    entity_name TEXT,
    user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
    ip_address  TEXT,
    metadata    JSONB DEFAULT '{}',
    created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_analytics_event_type ON analytics_events(event_type);
CREATE INDEX IF NOT EXISTS idx_analytics_section ON analytics_events(section);
CREATE INDEX IF NOT EXISTS idx_analytics_created ON analytics_events(created_at);
CREATE INDEX IF NOT EXISTS idx_analytics_entity ON analytics_events(entity_id);

CREATE TABLE IF NOT EXISTS app_settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS digest_issues (
    id              SERIAL PRIMARY KEY,
    issue_number    INTEGER NOT NULL UNIQUE,
    title           TEXT NOT NULL,
    subject         TEXT NOT NULL,
    html_content    TEXT NOT NULL,
    plain_text      TEXT NOT NULL,
    summary         JSONB NOT NULL DEFAULT '{}',
    days_covered    INTEGER NOT NULL DEFAULT 7,
    custom_content  TEXT DEFAULT '',
    created_at      TIMESTAMPTZ DEFAULT now(),
    sent_at         TIMESTAMPTZ,
    recipient_count INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_digest_issues_issue_number ON digest_issues(issue_number);
CREATE INDEX IF NOT EXISTS idx_digest_issues_created_at ON digest_issues(created_at DESC);

CREATE SEQUENCE IF NOT EXISTS digest_issue_number_seq START WITH 1;

CREATE TABLE IF NOT EXISTS user_course_enrollments (
    user_id          UUID REFERENCES users(id) ON DELETE CASCADE,
    course_id        UUID REFERENCES courses(id) ON DELETE CASCADE,
    enrolled_at      TIMESTAMPTZ DEFAULT now(),
    last_accessed_at TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (user_id, course_id)
);

CREATE TABLE IF NOT EXISTS course_analytics (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
    course_id       UUID REFERENCES courses(id) ON DELETE CASCADE,
    event_type      TEXT NOT NULL,
    video_id        UUID REFERENCES videos(id) ON DELETE SET NULL,
    session_seconds INTEGER DEFAULT 0,
    created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_course_analytics_course_id ON course_analytics(course_id);
CREATE INDEX IF NOT EXISTS idx_course_analytics_user_id ON course_analytics(user_id);

CREATE TABLE IF NOT EXISTS contribute_requests (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
    reason      TEXT NOT NULL,
    status      TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    admin_note  TEXT,
    reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMPTZ,
    created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contribute_requests_user_id ON contribute_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_contribute_requests_status ON contribute_requests(status);

CREATE TABLE IF NOT EXISTS video_attachments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    video_id        UUID REFERENCES videos(id) ON DELETE CASCADE,
    filename        TEXT NOT NULL,
    display_name    TEXT,
    file_path       TEXT NOT NULL,
    file_size       BIGINT NOT NULL,
    mime_type       TEXT,
    sort_order      INTEGER DEFAULT 0,
    created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_video_attachments_video ON video_attachments(video_id);

CREATE TABLE IF NOT EXISTS articles (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title           TEXT NOT NULL,
    slug            TEXT UNIQUE NOT NULL,
    summary         TEXT,
    content         TEXT NOT NULL DEFAULT '',
    category        TEXT NOT NULL DEFAULT 'General',
    author_id       UUID REFERENCES users(id) ON DELETE SET NULL,
    author_name     TEXT,
    is_published    BOOLEAN DEFAULT false,
    is_active       BOOLEAN DEFAULT true,
    published_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_articles_slug ON articles(slug);
CREATE INDEX IF NOT EXISTS idx_articles_category ON articles(category);
CREATE INDEX IF NOT EXISTS idx_articles_published ON articles(is_published) WHERE is_published = true;
CREATE INDEX IF NOT EXISTS idx_articles_search ON articles USING GIN(
    to_tsvector('english', title || ' ' || COALESCE(summary, '') || ' ' || content)
);

CREATE TABLE IF NOT EXISTS admin_audit_log (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ts          TIMESTAMPTZ NOT NULL DEFAULT now(),
    admin_id    UUID REFERENCES users(id) ON DELETE SET NULL,
    admin_name  TEXT,
    action      TEXT NOT NULL,
    target_type TEXT,
    target_id   TEXT,
    details     JSONB DEFAULT '{}'::jsonb,
    ip_address  TEXT,
    request_id  TEXT
);

CREATE INDEX IF NOT EXISTS admin_audit_log_ts_idx ON admin_audit_log (ts DESC);
CREATE INDEX IF NOT EXISTS admin_audit_log_admin_idx ON admin_audit_log (admin_id);
    """)


def downgrade() -> None:
    pass
