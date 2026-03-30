-- Digest issue tracking
CREATE TABLE IF NOT EXISTS digest_issues (
    id SERIAL PRIMARY KEY,
    issue_number INTEGER NOT NULL UNIQUE,
    title TEXT NOT NULL,
    subject TEXT NOT NULL,
    html_content TEXT NOT NULL,
    plain_text TEXT NOT NULL,
    summary JSONB NOT NULL DEFAULT '{}',
    days_covered INTEGER NOT NULL DEFAULT 7,
    custom_content TEXT DEFAULT '',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    sent_at TIMESTAMP WITH TIME ZONE,
    recipient_count INTEGER DEFAULT 0
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_digest_issues_issue_number ON digest_issues(issue_number);
CREATE INDEX IF NOT EXISTS idx_digest_issues_created_at ON digest_issues(created_at DESC);

-- Sequence for auto-incrementing issue numbers
CREATE SEQUENCE IF NOT EXISTS digest_issue_number_seq START WITH 1;
