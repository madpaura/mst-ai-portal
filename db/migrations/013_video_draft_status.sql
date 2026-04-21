-- Add 'draft' as a valid video status and make it the default for new videos.
-- Previously the default was 'processing', causing the spinner/cancel button
-- to appear immediately after creating a video before any file is uploaded.

ALTER TABLE videos DROP CONSTRAINT IF EXISTS videos_status_check;
ALTER TABLE videos ADD CONSTRAINT videos_status_check
    CHECK (status IN ('draft', 'processing', 'ready', 'error', 'uploaded'));

ALTER TABLE videos ALTER COLUMN status SET DEFAULT 'draft';

-- Fix any existing rows that are 'processing' but have no raw file / no transcode job
-- (i.e. stuck from the old broken default). Leave rows with real jobs untouched.
UPDATE videos
SET status = 'draft'
WHERE status = 'processing'
  AND hls_path IS NULL
  AND id NOT IN (
      SELECT DISTINCT video_id FROM transcode_jobs
      WHERE status IN ('pending', 'processing')
  );
