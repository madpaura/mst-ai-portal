-- Migration: Issues #13, #14, #17
-- Run on existing databases that already have 001_features.sql applied

-- Issue #13: Configurable banner duration
ALTER TABLE video_banners ADD COLUMN IF NOT EXISTS banner_duration_s INTEGER NOT NULL DEFAULT 3;

-- Issue #17: RSS feed sources for auto-importing news articles
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
