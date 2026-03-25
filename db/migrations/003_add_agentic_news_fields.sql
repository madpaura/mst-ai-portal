-- Add fields needed for agentic news to existing news_feed table
-- These fields will be used by the agentic news system

ALTER TABLE news_feed 
ADD COLUMN IF NOT EXISTS file_path TEXT,
ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}',
ADD COLUMN IF NOT EXISTS slug TEXT;

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_news_feed_slug ON news_feed (slug) WHERE slug IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_news_feed_tags ON news_feed USING GIN (tags) WHERE tags IS NOT NULL;

-- Add unique constraint on slug to prevent duplicates
ALTER TABLE news_feed 
ADD CONSTRAINT news_feed_slug_unique 
UNIQUE (slug) 
DEFERRABLE INITIALLY DEFERRED;
