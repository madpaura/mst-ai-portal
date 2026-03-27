---------------------------------------------------
-- VIDEO ATTACHMENTS
---------------------------------------------------
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

---------------------------------------------------
-- ARTICLES
---------------------------------------------------
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

-- Update page_views section check to include 'articles'
ALTER TABLE page_views DROP CONSTRAINT IF EXISTS page_views_section_check;
ALTER TABLE page_views ADD CONSTRAINT page_views_section_check
    CHECK (section IN ('solutions', 'marketplace', 'ignite', 'news', 'articles', 'other'));
