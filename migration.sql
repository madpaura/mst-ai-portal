-- Run once to create the news_articles table
-- Works with PostgreSQL 13+

CREATE TABLE IF NOT EXISTS news_articles (
    id           SERIAL PRIMARY KEY,
    slug         TEXT UNIQUE NOT NULL,
    title        TEXT NOT NULL,
    source       TEXT,
    source_url   TEXT,
    summary      TEXT,
    tags         TEXT[]       DEFAULT '{}',
    file_path    TEXT,
    published_at TIMESTAMPTZ,
    created_at   TIMESTAMPTZ  DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_news_created  ON news_articles (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_news_tags     ON news_articles USING GIN (tags);
