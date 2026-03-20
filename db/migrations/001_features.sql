-- Migration: Add tables for Issues #1-#7
-- Run on existing databases that already have init.sql applied

-- MARKETPLACE SETTINGS (Issue #5)
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

-- Extra columns on forge_components for git tracking
ALTER TABLE forge_components ADD COLUMN IF NOT EXISTS git_repo_url TEXT;
ALTER TABLE forge_components ADD COLUMN IF NOT EXISTS git_ref TEXT;
ALTER TABLE forge_components ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ;
ALTER TABLE forge_components ADD COLUMN IF NOT EXISTS howto_guide TEXT;

-- FORGE SYNC JOBS (Issues #2, #3)
CREATE TABLE IF NOT EXISTS forge_sync_jobs (
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
    started_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT now()
);

-- SOLUTION CARDS (Issue #6)
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
    sort_order      INTEGER DEFAULT 0,
    is_active       BOOLEAN DEFAULT true,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);

-- NEWS FEED (Issue #7)
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

-- Seed solution cards (only if table is empty)
INSERT INTO solution_cards (title, subtitle, description, long_description, icon, icon_color, sort_order)
SELECT * FROM (VALUES
    ('Coding Agents', 'AI-Powered IDE', 'Real-time AI IDE integration for hardware description languages with intelligent auto-completion and bug detection.', '## Coding Agents

Our coding agents provide real-time AI assistance directly in your IDE:

- **Intelligent Auto-completion** for SystemVerilog, VHDL, and Verilog
- **Bug Detection** with instant feedback on common RTL mistakes
- **Code Refactoring** suggestions for cleaner, more efficient designs
- **Documentation Generation** from your code comments and structure', 'terminal', 'text-primary', 1),
    ('Unit Test Generator', 'Automated Verification', 'Automated verification suites that generate comprehensive UVM components and test benches to ensure silicon reliability.', '## Unit Test Generator

Automate your verification workflow:

- **UVM Component Generation** — Sequences, drivers, monitors, and scoreboards
- **Coverage-Driven** test generation to hit corner cases
- **Regression Suite** management and tracking
- **Assertion Generation** from design specifications', 'fact_check', 'text-green-500', 2),
    ('Spec-to-Code', 'Architecture Translation', 'Transform high-level architectural specifications directly into synthesizable, optimized RTL code with minimal manual overhead.', '## Spec-to-Code

From specification to silicon:

- **Natural Language** to RTL code generation
- **Block Diagram** to hierarchical module structure
- **Protocol Support** — AXI, AHB, APB, and custom interfaces
- **Optimization** for area, power, and timing constraints', 'developer_board', 'text-amber-500', 3),
    ('Performance Monitoring', 'Silicon Analytics', 'Real-time telemetry and deep-dive analysis for silicon workloads during simulation and emulation phases.', '## Performance Monitoring

Deep visibility into your silicon:

- **Real-time Telemetry** during simulation runs
- **Bottleneck Detection** with AI-driven analysis
- **Resource Utilization** tracking and optimization
- **Historical Trends** and regression comparison', 'monitoring', 'text-purple-500', 4)
) AS v(title, subtitle, description, long_description, icon, icon_color, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM solution_cards LIMIT 1);
