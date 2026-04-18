-- Migration 010: LLM Content Pipeline
-- Adds AI-generated fields to videos and articles, plus a transcripts table.

-- ── Videos: AI fields ────────────────────────────────────────────────────────
ALTER TABLE videos
    ADD COLUMN IF NOT EXISTS ai_summary       TEXT,
    ADD COLUMN IF NOT EXISTS ai_topics        TEXT[],
    ADD COLUMN IF NOT EXISTS ai_tags          TEXT[],
    ADD COLUMN IF NOT EXISTS ai_status        TEXT DEFAULT 'pending'
                                              CHECK (ai_status IN ('pending','processing','done','error')),
    ADD COLUMN IF NOT EXISTS ai_processed_at  TIMESTAMPTZ;

-- ── Articles: AI fields ───────────────────────────────────────────────────────
ALTER TABLE articles
    ADD COLUMN IF NOT EXISTS ai_summary       TEXT,
    ADD COLUMN IF NOT EXISTS ai_topics        TEXT[],
    ADD COLUMN IF NOT EXISTS ai_tags          TEXT[],
    ADD COLUMN IF NOT EXISTS ai_status        TEXT DEFAULT 'pending'
                                              CHECK (ai_status IN ('pending','processing','done','error')),
    ADD COLUMN IF NOT EXISTS ai_processed_at  TIMESTAMPTZ;

-- ── Video transcripts ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS video_transcripts (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    video_id     UUID NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    transcript   TEXT NOT NULL,
    language     TEXT DEFAULT 'en',
    provider     TEXT DEFAULT 'whisper',   -- whisper | openai-whisper
    created_at   TIMESTAMPTZ DEFAULT now(),
    UNIQUE (video_id)
);

CREATE INDEX IF NOT EXISTS idx_video_transcripts_video ON video_transcripts(video_id);
CREATE INDEX IF NOT EXISTS idx_videos_ai_status ON videos(ai_status) WHERE ai_status IN ('pending','error');
CREATE INDEX IF NOT EXISTS idx_articles_ai_status ON articles(ai_status) WHERE ai_status IN ('pending','error');
