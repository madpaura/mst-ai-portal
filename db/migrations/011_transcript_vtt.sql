-- Migration 011: Add WebVTT storage to video_transcripts
ALTER TABLE video_transcripts
    ADD COLUMN IF NOT EXISTS vtt_content TEXT;
