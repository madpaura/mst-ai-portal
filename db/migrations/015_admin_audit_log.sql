-- Admin audit log table for tracking privileged actions
CREATE TABLE IF NOT EXISTS admin_audit_log (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ts          TIMESTAMPTZ NOT NULL DEFAULT now(),
    admin_id    UUID REFERENCES users(id) ON DELETE SET NULL,
    admin_name  TEXT,
    action      TEXT NOT NULL,       -- e.g. 'user.create', 'user.role_change', 'user.delete'
    target_type TEXT,                -- e.g. 'user', 'video', 'article'
    target_id   TEXT,
    details     JSONB DEFAULT '{}'::jsonb,
    ip_address  TEXT,
    request_id  TEXT
);

CREATE INDEX IF NOT EXISTS admin_audit_log_ts_idx ON admin_audit_log (ts DESC);
CREATE INDEX IF NOT EXISTS admin_audit_log_admin_idx ON admin_audit_log (admin_id);
