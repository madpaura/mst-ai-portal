-- Migration 008: Course enrollment and progress tracking (Issue #29)

-- User course enrollment / subscription
CREATE TABLE IF NOT EXISTS user_course_enrollments (
    user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
    course_id   UUID REFERENCES courses(id) ON DELETE CASCADE,
    enrolled_at TIMESTAMPTZ DEFAULT now(),
    last_accessed_at TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (user_id, course_id)
);

-- Analytics: course engagement events
CREATE TABLE IF NOT EXISTS course_analytics (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
    course_id       UUID REFERENCES courses(id) ON DELETE CASCADE,
    event_type      TEXT NOT NULL,  -- 'enroll', 'unenroll', 'video_complete', 'session_start'
    video_id        UUID REFERENCES videos(id) ON DELETE SET NULL,
    session_seconds INTEGER DEFAULT 0,
    created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_course_analytics_course_id ON course_analytics(course_id);
CREATE INDEX IF NOT EXISTS idx_course_analytics_user_id ON course_analytics(user_id);
