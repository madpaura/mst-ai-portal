-- MST AI Portal — Database Schema
-- Run once on fresh PostgreSQL instance

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

---------------------------------------------------
-- USERS & AUTH
---------------------------------------------------
CREATE TABLE users (
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

CREATE INDEX idx_users_saml_name_id ON users (saml_name_id) WHERE saml_name_id IS NOT NULL;

CREATE TABLE sessions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
    token_hash  TEXT NOT NULL,
    expires_at  TIMESTAMPTZ NOT NULL,
    created_at  TIMESTAMPTZ DEFAULT now()
);

---------------------------------------------------
-- COURSES & VIDEOS (Ignite)
---------------------------------------------------
CREATE TABLE courses (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title       TEXT NOT NULL,
    slug        TEXT UNIQUE NOT NULL,
    description TEXT,
    is_active   BOOLEAN DEFAULT true,
    sort_order  INTEGER DEFAULT 0,
    created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE videos (
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

CREATE TABLE video_chapters (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    video_id    UUID REFERENCES videos(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    start_time  INTEGER NOT NULL,
    sort_order  INTEGER DEFAULT 0
);

CREATE TABLE video_quality_settings (
    video_id    UUID REFERENCES videos(id) ON DELETE CASCADE,
    quality     TEXT NOT NULL CHECK (quality IN ('360p', '720p', '1080p')),
    enabled     BOOLEAN DEFAULT true,
    crf         INTEGER DEFAULT 23,
    PRIMARY KEY (video_id, quality)
);

CREATE TABLE user_video_progress (
    user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
    video_id        UUID REFERENCES videos(id) ON DELETE CASCADE,
    watched_seconds INTEGER DEFAULT 0,
    completed       BOOLEAN DEFAULT false,
    last_position   INTEGER DEFAULT 0,
    updated_at      TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (user_id, video_id)
);

CREATE TABLE user_notes (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
    video_id    UUID REFERENCES videos(id) ON DELETE CASCADE,
    timestamp_s INTEGER NOT NULL,
    content     TEXT NOT NULL,
    screenshot  TEXT,
    created_at  TIMESTAMPTZ DEFAULT now(),
    updated_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE seed_notes (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    video_id    UUID REFERENCES videos(id) ON DELETE CASCADE,
    timestamp_s INTEGER NOT NULL,
    content     TEXT NOT NULL,
    created_by  UUID REFERENCES users(id),
    created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE howto_guides (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    video_id    UUID REFERENCES videos(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    content     TEXT NOT NULL,
    version     TEXT DEFAULT '1.0',
    created_at  TIMESTAMPTZ DEFAULT now(),
    updated_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE video_banners (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    video_id        UUID REFERENCES videos(id) ON DELETE CASCADE UNIQUE,
    variant         TEXT NOT NULL DEFAULT 'A' CHECK (variant IN ('A', 'B', 'C')),
    company_logo    TEXT NOT NULL DEFAULT 'SAMSUNG',
    series_tag      TEXT NOT NULL DEFAULT 'KNOWLEDGE SERIES',
    topic           TEXT NOT NULL DEFAULT 'Intro to AI Agents',
    subtopic        TEXT NOT NULL DEFAULT 'Environment Setup & First Run',
    episode         TEXT NOT NULL DEFAULT 'EP 01',
    duration        TEXT NOT NULL DEFAULT '3:15',
    presenter       TEXT NOT NULL DEFAULT 'Vishwa',
    presenter_initial TEXT NOT NULL DEFAULT 'V',
    banner_duration_s INTEGER NOT NULL DEFAULT 3 CHECK (banner_duration_s >= 3 AND banner_duration_s <= 10),
    status          TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'generating', 'ready', 'error')),
    brand_title     TEXT NOT NULL DEFAULT 'AI Ignite',
    banner_video_path TEXT,
    error           TEXT,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE transcode_jobs (
    id              BIGSERIAL PRIMARY KEY,
    video_id        UUID REFERENCES videos(id) ON DELETE CASCADE,
    status          TEXT DEFAULT 'pending'
                    CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    attempts        INTEGER DEFAULT 0,
    max_attempts    INTEGER DEFAULT 3,
    error           TEXT,
    started_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_jobs_pending ON transcode_jobs(status) WHERE status = 'pending';

---------------------------------------------------
-- FORGE / MARKETPLACE
---------------------------------------------------
CREATE TABLE forge_components (
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
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_forge_type ON forge_components(component_type);
CREATE INDEX idx_forge_tags ON forge_components USING GIN(tags);
CREATE INDEX idx_forge_search ON forge_components USING GIN(
    to_tsvector('english', name || ' ' || COALESCE(description, ''))
);

CREATE TABLE forge_install_events (
    id              BIGSERIAL PRIMARY KEY,
    component_id    UUID REFERENCES forge_components(id) ON DELETE CASCADE,
    user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
    installed_at    TIMESTAMPTZ DEFAULT now()
);

---------------------------------------------------
-- SOLUTIONS
---------------------------------------------------
CREATE TABLE capabilities (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    icon        TEXT NOT NULL,
    title       TEXT NOT NULL,
    description TEXT NOT NULL,
    sort_order  INTEGER DEFAULT 0,
    is_active   BOOLEAN DEFAULT true
);

CREATE TABLE announcements (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title       TEXT NOT NULL,
    content     TEXT,
    badge       TEXT,
    is_active   BOOLEAN DEFAULT true,
    created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE contact_submissions (
    id          BIGSERIAL PRIMARY KEY,
    name        TEXT NOT NULL,
    email       TEXT NOT NULL,
    message     TEXT NOT NULL,
    created_at  TIMESTAMPTZ DEFAULT now()
);

---------------------------------------------------
-- SEED DATA
---------------------------------------------------

-- Admin user is seeded by the API on startup (auth/seed.py) when AUTH_MODE=open
-- This ensures the bcrypt hash is always generated with the correct library version

-- Seed capabilities
INSERT INTO capabilities (icon, title, description, sort_order) VALUES
('terminal', 'Coding Agents', 'Real-time AI IDE integration for hardware description languages with intelligent auto-completion and bug detection.', 1),
('fact_check', 'Unit Test Generator', 'Automated verification suites that generate comprehensive UVM components and test benches to ensure silicon reliability.', 2),
('developer_board', 'Spec-to-Code', 'Transform high-level architectural specifications directly into synthesizable, optimized RTL code with minimal manual overhead.', 3),
('monitoring', 'Performance Monitoring', 'Real-time telemetry and deep-dive analysis for silicon workloads during simulation and emulation phases.', 4);

-- Seed default course
INSERT INTO courses (title, slug, description, sort_order) VALUES
('AI Ignite Foundations', 'ai-ignite-foundations', 'Core training series covering Code-mate, RAG, Agents, and LLM fundamentals.', 1);

-- Seed forge components
INSERT INTO forge_components (slug, name, component_type, description, icon, icon_color, version, install_command, badge, author, tags) VALUES
('rtl-verify-v2', 'RTL Verification Agent', 'agent', 'Automated testbench generation and coverage analysis for SystemVerilog designs. Reduces verification cycles by 40%.', 'architecture', 'text-primary', 'v2.4.1', 'forge install rtl-verify-v2', 'verified', 'Silicon AI Team', ARRAY['verification', 'systemverilog', 'uvm']),
('uvm-master', 'UVM Testbench Skill', 'skill', 'Extends base agents with specialized knowledge of Universal Verification Methodology patterns and macros.', 'psychology', 'text-amber-500', 'v1.0.8', 'forge add skill uvm-master', NULL, 'Verification Team', ARRAY['uvm', 'testbench', 'verification']),
('jira-spec', 'Jira-to-Spec MCP', 'mcp_server', 'Bi-directional synchronization between Jira tickets and design specification documents for traceability.', 'sync_alt', 'text-purple-500', 'v3.2.0', 'forge mcp connect jira-spec', NULL, 'DevOps Team', ARRAY['jira', 'specs', 'traceability']),
('timing-ai-pro', 'Timing Closure Agent', 'agent', 'Analyzes static timing reports and suggests placement/routing fixes for high-frequency designs.', 'auto_timer', 'text-rose-500', 'v0.9.4-beta', 'forge install timing-ai-pro', 'verified', 'PnR Team', ARRAY['timing', 'sta', 'placement']),
('power-opt', 'Power Analysis Skill', 'skill', 'Advanced power estimation logic based on switching activity (VCD/FSDB files).', 'energy_savings_leaf', 'text-cyan-500', 'v1.1.2', 'forge add skill power-opt', NULL, 'Power Team', ARRAY['power', 'vcd', 'estimation']),
('confluence-hw', 'Confluence Spec MCP', 'mcp_server', 'Contextual retrieval of hardware specifications directly from Confluence workspaces into the agent context.', 'description', 'text-indigo-500', 'v2.1.0', 'forge mcp connect confluence-hw', NULL, 'Knowledge Team', ARRAY['confluence', 'specs', 'retrieval']);

---------------------------------------------------
-- MARKETPLACE SETTINGS (Issue #5)
---------------------------------------------------
CREATE TABLE forge_settings (
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

-- Track which forge_components came from which git repo
ALTER TABLE forge_components ADD COLUMN IF NOT EXISTS git_repo_url TEXT;
ALTER TABLE forge_components ADD COLUMN IF NOT EXISTS git_ref TEXT;
ALTER TABLE forge_components ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ;
ALTER TABLE forge_components ADD COLUMN IF NOT EXISTS howto_guide TEXT;

---------------------------------------------------
-- FORGE SYNC JOBS (Issues #2, #3)
---------------------------------------------------
CREATE TABLE forge_sync_jobs (
    id              BIGSERIAL PRIMARY KEY,
    settings_id     UUID REFERENCES forge_settings(id) ON DELETE CASCADE,
    trigger_type    TEXT NOT NULL DEFAULT 'manual'
                    CHECK (trigger_type IN ('manual', 'scheduled', 'nightly')),
    status          TEXT DEFAULT 'pending'
                    CHECK (status IN ('pending', 'running', 'completed', 'failed')),
    components_found    INTEGER DEFAULT 0,
    components_updated  INTEGER DEFAULT 0,
    components_created  INTEGER DEFAULT 0,
    error           TEXT,
    log             TEXT DEFAULT '',
    started_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT now()
);

---------------------------------------------------
-- SOLUTIONS CARDS (Issue #6)
---------------------------------------------------
CREATE TABLE solution_cards (
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

---------------------------------------------------
-- NEWS FEED (Issue #7)
---------------------------------------------------
CREATE TABLE news_feed (
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

---------------------------------------------------
-- RSS FEED SOURCES (Issue #17)
---------------------------------------------------
CREATE TABLE news_rss_feeds (
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

---------------------------------------------------
-- VIDEO LIKES
---------------------------------------------------
CREATE TABLE video_likes (
    user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
    video_id    UUID REFERENCES videos(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (user_id, video_id)
);

CREATE INDEX idx_video_likes_video ON video_likes(video_id);

---------------------------------------------------
-- PAGE VIEWS / VISITOR TRAFFIC
---------------------------------------------------
CREATE TABLE page_views (
    id          BIGSERIAL PRIMARY KEY,
    path        TEXT NOT NULL,
    section     TEXT NOT NULL CHECK (section IN ('solutions', 'marketplace', 'ignite', 'news', 'articles', 'other')),
    ip_address  TEXT,
    user_agent  TEXT,
    user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
    referrer    TEXT,
    created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_page_views_section ON page_views(section);
CREATE INDEX idx_page_views_created ON page_views(created_at);
CREATE INDEX idx_page_views_path ON page_views(path);

---------------------------------------------------
-- ANALYTICS EVENTS (generic event tracking)
---------------------------------------------------
CREATE TABLE analytics_events (
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

CREATE INDEX idx_analytics_event_type ON analytics_events(event_type);
CREATE INDEX idx_analytics_section ON analytics_events(section);
CREATE INDEX idx_analytics_created ON analytics_events(created_at);
CREATE INDEX idx_analytics_entity ON analytics_events(entity_id);

---------------------------------------------------
-- SEED DATA
---------------------------------------------------

-- Seed announcement
INSERT INTO announcements (title, content, badge) VALUES
('v2.4 Internal Release', 'New capabilities for RTL generation and verification automation.', 'v2.4');

-- Seed solution cards
INSERT INTO solution_cards (title, subtitle, description, long_description, icon, icon_color, sort_order) VALUES
('Coding Agents', 'AI-Powered IDE', 'Real-time AI IDE integration for hardware description languages with intelligent auto-completion and bug detection.', '## Coding Agents\n\nOur coding agents provide real-time AI assistance directly in your IDE:\n\n- **Intelligent Auto-completion** for SystemVerilog, VHDL, and Verilog\n- **Bug Detection** with instant feedback on common RTL mistakes\n- **Code Refactoring** suggestions for cleaner, more efficient designs\n- **Documentation Generation** from your code comments and structure', 'terminal', 'text-primary', 1),
('Unit Test Generator', 'Automated Verification', 'Automated verification suites that generate comprehensive UVM components and test benches to ensure silicon reliability.', '## Unit Test Generator\n\nAutomate your verification workflow:\n\n- **UVM Component Generation** — Sequences, drivers, monitors, and scoreboards\n- **Coverage-Driven** test generation to hit corner cases\n- **Regression Suite** management and tracking\n- **Assertion Generation** from design specifications', 'fact_check', 'text-green-500', 2),
('Spec-to-Code', 'Architecture Translation', 'Transform high-level architectural specifications directly into synthesizable, optimized RTL code with minimal manual overhead.', '## Spec-to-Code\n\nFrom specification to silicon:\n\n- **Natural Language** to RTL code generation\n- **Block Diagram** to hierarchical module structure\n- **Protocol Support** — AXI, AHB, APB, and custom interfaces\n- **Optimization** for area, power, and timing constraints', 'developer_board', 'text-amber-500', 3),
('Performance Monitoring', 'Silicon Analytics', 'Real-time telemetry and deep-dive analysis for silicon workloads during simulation and emulation phases.', '## Performance Monitoring\n\nDeep visibility into your silicon:\n\n- **Real-time Telemetry** during simulation runs\n- **Bottleneck Detection** with AI-driven analysis\n- **Resource Utilization** tracking and optimization\n- **Historical Trends** and regression comparison', 'monitoring', 'text-purple-500', 4);

---------------------------------------------------
-- VIDEO ATTACHMENTS
---------------------------------------------------
CREATE TABLE video_attachments (
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

CREATE INDEX idx_video_attachments_video ON video_attachments(video_id);

---------------------------------------------------
-- ARTICLES
---------------------------------------------------
CREATE TABLE articles (
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

CREATE INDEX idx_articles_slug ON articles(slug);
CREATE INDEX idx_articles_category ON articles(category);
CREATE INDEX idx_articles_published ON articles(is_published) WHERE is_published = true;
CREATE INDEX idx_articles_search ON articles USING GIN(
    to_tsvector('english', title || ' ' || COALESCE(summary, '') || ' ' || content)
);

---------------------------------------------------
-- APP SETTINGS (key-value store)
---------------------------------------------------
CREATE TABLE IF NOT EXISTS app_settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT '{}'
);

---------------------------------------------------
-- DIGEST ISSUES (learning newsletter history)
---------------------------------------------------
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

---------------------------------------------------
-- COURSE ENROLLMENT & ANALYTICS (Migration 008)
---------------------------------------------------
CREATE TABLE user_course_enrollments (
    user_id          UUID REFERENCES users(id) ON DELETE CASCADE,
    course_id        UUID REFERENCES courses(id) ON DELETE CASCADE,
    enrolled_at      TIMESTAMPTZ DEFAULT now(),
    last_accessed_at TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (user_id, course_id)
);

CREATE TABLE course_analytics (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
    course_id       UUID REFERENCES courses(id) ON DELETE CASCADE,
    event_type      TEXT NOT NULL,
    video_id        UUID REFERENCES videos(id) ON DELETE SET NULL,
    session_seconds INTEGER DEFAULT 0,
    created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_course_analytics_course_id ON course_analytics(course_id);
CREATE INDEX idx_course_analytics_user_id ON course_analytics(user_id);

---------------------------------------------------
-- CONTRIBUTION REQUESTS (Migration 009)
---------------------------------------------------
CREATE TABLE contribute_requests (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
    reason      TEXT NOT NULL,
    status      TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    admin_note  TEXT,
    reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMPTZ,
    created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_contribute_requests_user_id ON contribute_requests(user_id);
CREATE INDEX idx_contribute_requests_status ON contribute_requests(status);

---------------------------------------------------
-- ADMIN AUDIT LOG (Migration 015)
---------------------------------------------------
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
