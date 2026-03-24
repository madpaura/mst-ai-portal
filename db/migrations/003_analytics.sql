-- Migration: Analytics & Likes
-- Adds video likes, page view tracking, and analytics events

---------------------------------------------------
-- VIDEO LIKES
---------------------------------------------------
CREATE TABLE IF NOT EXISTS video_likes (
    user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
    video_id    UUID REFERENCES videos(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (user_id, video_id)
);

CREATE INDEX IF NOT EXISTS idx_video_likes_video ON video_likes(video_id);

---------------------------------------------------
-- PAGE VIEWS / VISITOR TRAFFIC
---------------------------------------------------
CREATE TABLE IF NOT EXISTS page_views (
    id          BIGSERIAL PRIMARY KEY,
    path        TEXT NOT NULL,
    section     TEXT NOT NULL CHECK (section IN ('solutions', 'marketplace', 'ignite', 'news', 'other')),
    ip_address  TEXT,
    user_agent  TEXT,
    user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
    referrer    TEXT,
    created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_page_views_section ON page_views(section);
CREATE INDEX IF NOT EXISTS idx_page_views_created ON page_views(created_at);
CREATE INDEX IF NOT EXISTS idx_page_views_path ON page_views(path);

---------------------------------------------------
-- ANALYTICS EVENTS (generic event tracking)
---------------------------------------------------
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
