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
    role            TEXT DEFAULT 'user' CHECK (role IN ('user', 'admin')),
    employee_id     TEXT,
    last_login      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT now()
);

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
                    CHECK (status IN ('processing', 'ready', 'error')),
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
    status          TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'generating', 'ready', 'error')),
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

-- Seed announcement
INSERT INTO announcements (title, content, badge) VALUES
('v2.4 Internal Release', 'New capabilities for RTL generation and verification automation.', 'v2.4');
