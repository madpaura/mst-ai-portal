-- Add 'cancelled' to transcode_jobs status constraint.
-- worker/transcoder.py transitions jobs to 'cancelled' on graceful shutdown
-- but the original constraint only allowed: pending | processing | completed | failed.

ALTER TABLE transcode_jobs DROP CONSTRAINT IF EXISTS transcode_jobs_status_check;
ALTER TABLE transcode_jobs ADD CONSTRAINT transcode_jobs_status_check
    CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled'));
