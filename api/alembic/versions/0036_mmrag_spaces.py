"""MMRAG spaces: request, approval and deployment tracking.

A space is one mmrag project requested from the portal. The portal never talks
to mmrag's services directly: mmrag_jobs records each `setup.sh` command the
mmrag-worker container runs on the remote host over SSH. Only one job per space
may be active, and the worker runs them one at a time because setup.sh allocates
ports without a lock.
"""
from alembic import op

revision = '0036'
down_revision = '0035'
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        CREATE TABLE IF NOT EXISTS mmrag_spaces (
            id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            slug              TEXT NOT NULL,
            name              TEXT NOT NULL,
            plm_project       TEXT NOT NULL,
            reason            TEXT NOT NULL,
            owner_id          UUID REFERENCES users(id) ON DELETE SET NULL,
            status            TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
                'pending', 'needs_info', 'rejected', 'deploying', 'deploy_failed',
                'deployed', 'live', 'stopped', 'delete_requested', 'deleting',
                'delete_failed', 'deleted'
            )),
            review_note       TEXT,
            delete_reason     TEXT,
            pre_delete_status TEXT,
            provisioned       BOOLEAN NOT NULL DEFAULT false,
            api_url           TEXT,
            mgmt_url          TEXT,
            backup_path       TEXT,
            health            JSONB,
            health_checked_at TIMESTAMPTZ,
            reviewed_by       UUID REFERENCES users(id) ON DELETE SET NULL,
            reviewed_at       TIMESTAMPTZ,
            created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)
    # A deleted space frees its slug; every other state keeps it reserved.
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_mmrag_spaces_slug "
        "ON mmrag_spaces (slug) WHERE status <> 'deleted'"
    )
    op.execute("CREATE INDEX IF NOT EXISTS idx_mmrag_spaces_owner ON mmrag_spaces (owner_id, created_at DESC)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_mmrag_spaces_status ON mmrag_spaces (status)")

    op.execute("""
        CREATE TABLE IF NOT EXISTS mmrag_jobs (
            id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            space_id      UUID NOT NULL REFERENCES mmrag_spaces(id) ON DELETE CASCADE,
            kind          TEXT NOT NULL CHECK (kind IN (
                'deploy', 'redeploy', 'start', 'stop', 'rotate_key', 'destroy', 'teardown'
            )),
            status        TEXT NOT NULL DEFAULT 'queued'
                          CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
            log           TEXT NOT NULL DEFAULT '',
            error         TEXT,
            requested_by  UUID REFERENCES users(id) ON DELETE SET NULL,
            created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
            started_at    TIMESTAMPTZ,
            finished_at   TIMESTAMPTZ
        )
    """)
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_mmrag_jobs_active "
        "ON mmrag_jobs (space_id) WHERE status IN ('queued', 'running')"
    )
    op.execute("CREATE INDEX IF NOT EXISTS idx_mmrag_jobs_space ON mmrag_jobs (space_id, created_at DESC)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_mmrag_jobs_queued ON mmrag_jobs (created_at) WHERE status = 'queued'")

    op.execute("""
        CREATE TABLE IF NOT EXISTS mmrag_space_events (
            id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            space_id    UUID NOT NULL REFERENCES mmrag_spaces(id) ON DELETE CASCADE,
            actor_id    UUID REFERENCES users(id) ON DELETE SET NULL,
            actor_name  TEXT,
            event       TEXT NOT NULL,
            note        TEXT,
            created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS idx_mmrag_events_space ON mmrag_space_events (space_id, created_at)")


def downgrade():
    op.execute("DROP TABLE IF EXISTS mmrag_space_events")
    op.execute("DROP TABLE IF EXISTS mmrag_jobs")
    op.execute("DROP TABLE IF EXISTS mmrag_spaces")
