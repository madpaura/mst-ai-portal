"""MMRAG Space Worker
Polls mmrag_jobs and runs setup.sh on the mmrag host over SSH.

Run standalone: python worker/mmrag_worker.py

Jobs run strictly one at a time: setup.sh picks ports without a lock, so two
parallel deploys could be handed the same port. Run a single replica.
"""
import asyncio
import json
import os
import sys
import time

import asyncpg
from loguru import logger as log

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import database
from config import settings
from mmrag import notify, remote
from mmrag.service import SPACE_SELECT, add_event, row_to_space

POLL_INTERVAL = int(os.getenv("MMRAG_POLL_INTERVAL", "3"))
LOG_FLUSH_SECONDS = 2.0
MAX_LOG_CHARS = 200_000
# About five minutes: `rotate-key` returns while its rollout is still running.
HEALTH_ATTEMPTS = 15
HEALTH_RETRY_SECONDS = 20


class JobFailed(Exception):
    pass


class JobLog:
    """Buffers job output and writes it to the job row every couple of seconds."""

    def __init__(self, pool: asyncpg.Pool, job_id):
        self.pool = pool
        self.job_id = job_id
        self.text = ""
        self.last_flush = 0.0

    async def write(self, line: str):
        self.text += line
        if len(self.text) > MAX_LOG_CHARS:
            self.text = "[earlier output truncated]\n" + self.text[-MAX_LOG_CHARS:]
        if time.monotonic() - self.last_flush >= LOG_FLUSH_SECONDS:
            await self.flush()

    async def flush(self):
        await self.pool.execute("UPDATE mmrag_jobs SET log = $2 WHERE id = $1", self.job_id, self.text)
        self.last_flush = time.monotonic()

    async def step(self, message: str):
        await self.write(f"\n==> {message}\n")


async def run_step(log_: JobLog, args: list[str], stdin_text: str | None = None) -> remote.RemoteResult:
    await log_.step(f"setup.sh {' '.join(args)}")
    result = await remote.run(
        args, timeout=settings.MMRAG_JOB_TIMEOUT, on_line=log_.write, stdin_text=stdin_text,
    )
    if not result.ok:
        tail = result.output.strip().splitlines()[-1:] or [""]
        raise JobFailed(f"setup.sh {args[0]} exited with {result.exit_status}: {tail[0][:300]}")
    return result


async def verify_healthy(pool: asyncpg.Pool, log_: JobLog, space) -> dict:
    """Confirm the stack with `status`, because `deploy` exits 0 when it isn't healthy."""
    health: dict = {}
    for attempt in range(1, HEALTH_ATTEMPTS + 1):
        await log_.step(f"setup.sh status {space['slug']} (check {attempt}/{HEALTH_ATTEMPTS})")
        health = await remote.check_health(space["slug"])
        await log_.write(json.dumps(health) + "\n")
        await save_health(pool, space["id"], health)
        if health["healthy"]:
            return health
        if attempt < HEALTH_ATTEMPTS:
            await asyncio.sleep(HEALTH_RETRY_SECONDS)
    not_ok = [s["service"] for s in health.get("services", []) if s["state"] != "healthy"]
    raise JobFailed(f"Services not healthy: {', '.join(not_ok) or health.get('error') or 'unknown'}")


async def save_health(pool: asyncpg.Pool, space_id, health: dict):
    await pool.execute(
        "UPDATE mmrag_spaces SET health = $2::jsonb, health_checked_at = now() WHERE id = $1",
        space_id, json.dumps(health),
    )


async def save_urls(pool: asyncpg.Pool, space) -> None:
    urls = remote.space_urls(space["slug"])
    await pool.execute(
        "UPDATE mmrag_spaces SET api_url = $2, mgmt_url = $3 WHERE id = $1",
        space["id"], urls["api_url"], urls["mgmt_url"],
    )


async def do_deploy(pool: asyncpg.Pool, log_: JobLog, space):
    # `setup.sh deploy` on an existing name updates that project, and its owner
    # could then read the key. Never adopt a project this portal didn't create.
    if not space["provisioned"]:
        await log_.step("setup.sh list (name check)")
        if space["slug"] in await remote.list_projects():
            raise JobFailed(
                f"A project named '{space['slug']}' already exists on the mmrag host. "
                "Ask the owner to choose another space ID."
            )
        await pool.execute("UPDATE mmrag_spaces SET provisioned = true WHERE id = $1", space["id"])
    await run_step(log_, ["deploy", space["slug"]])
    await verify_healthy(pool, log_, space)
    await save_urls(pool, space)


async def do_redeploy(pool: asyncpg.Pool, log_: JobLog, space):
    await run_step(log_, ["deploy", space["slug"]])
    await verify_healthy(pool, log_, space)
    await save_urls(pool, space)


async def do_stop(pool: asyncpg.Pool, log_: JobLog, space):
    await run_step(log_, ["down", space["slug"]])


async def do_rotate_key(pool: asyncpg.Pool, log_: JobLog, space):
    await run_step(log_, ["rotate-key", space["slug"]])
    await verify_healthy(pool, log_, space)


async def do_destroy(pool: asyncpg.Pool, log_: JobLog, space):
    if space["slug"] not in await remote.list_projects():
        await log_.step("Project is already gone from the mmrag host")
        return
    backup = await run_step(log_, ["backup", space["slug"]])
    backup_path = remote.parse_backup_path(backup.output)
    if not backup_path:
        raise JobFailed("Backup finished but reported no archive; not deleting without one")
    await pool.execute("UPDATE mmrag_spaces SET backup_path = $2 WHERE id = $1", space["id"], backup_path)
    await run_step(log_, ["destroy", space["slug"]], stdin_text=space["slug"])


async def do_teardown(pool: asyncpg.Pool, log_: JobLog, space):
    """Remove a deployment that never went live, so there is no user data to back up."""
    if space["slug"] in await remote.list_projects():
        await run_step(log_, ["destroy", space["slug"]], stdin_text=space["slug"])


HANDLERS = {
    "deploy": do_deploy,
    "redeploy": do_redeploy,
    "start": do_redeploy,
    "stop": do_stop,
    "rotate_key": do_rotate_key,
    "destroy": do_destroy,
    "teardown": do_teardown,
}

# kind -> (status the space must be in, status on success, status on failure)
TRANSITIONS = {
    "deploy": ("deploying", "deployed", "deploy_failed"),
    "start": ("stopped", "live", None),
    "stop": ("live", "stopped", None),
    "destroy": ("deleting", "deleted", "delete_failed"),
}


async def apply_outcome(pool: asyncpg.Pool, job, succeeded: bool, error: str | None):
    """Finish the job and move the space in one transaction, then notify."""
    kind = job["kind"]
    expected, on_success, on_failure = TRANSITIONS.get(kind, (None, None, None))
    target = on_success if succeeded else on_failure

    async with pool.acquire() as conn, conn.transaction():
        await conn.execute(
            "UPDATE mmrag_jobs SET status = $2, error = $3, finished_at = now() WHERE id = $1",
            job["id"], "succeeded" if succeeded else "failed", error,
        )
        if target:
            await conn.execute(
                "UPDATE mmrag_spaces SET status = $3, updated_at = now() WHERE id = $1 AND status = $2",
                job["space_id"], expected, target,
            )
        if succeeded and kind in ("destroy", "teardown"):
            await conn.execute(
                "UPDATE mmrag_spaces SET provisioned = false, api_url = NULL, mgmt_url = NULL, "
                "health = NULL, health_checked_at = NULL WHERE id = $1",
                job["space_id"],
            )
        if succeeded and kind == "stop":
            await conn.execute(
                "UPDATE mmrag_spaces SET health = NULL, health_checked_at = NULL WHERE id = $1",
                job["space_id"],
            )
        await add_event(conn, job["space_id"], f"{kind}_{'succeeded' if succeeded else 'failed'}", note=error)

    row = await pool.fetchrow(f"{SPACE_SELECT} WHERE s.id = $1", job["space_id"])
    await send_notifications(row_to_space(row), kind, succeeded, error)


async def send_notifications(space: dict, kind: str, succeeded: bool, error: str | None):
    if not succeeded:
        await notify.notify_reviewers(
            space, f"MMRAG space job failed: {space['name']}", "A deployment job failed",
            f"The {kind} job failed. Open the job log in the admin panel for details.", error,
        )
    elif kind == "deploy":
        await notify.notify_reviewers(
            space, f"MMRAG space ready to verify: {space['name']}", "Ready to verify",
            "Deployment finished and every service is healthy. Verify the space, then give final approval.",
        )
    elif kind == "rotate_key":
        await notify.notify_owner(
            space, f"MMRAG space access key changed: {space['name']}", "Access key changed",
            "An admin replaced this space's access key. Get the new key from the portal and update any scripts using the old one.",
        )
    elif kind == "destroy":
        await notify.notify_owner(
            space, f"MMRAG space deleted: {space['name']}", "Space deleted",
            "This space has been deleted. A backup was kept on the mmrag host.",
        )


async def run_job(pool: asyncpg.Pool, job):
    space = await pool.fetchrow(f"{SPACE_SELECT} WHERE s.id = $1", job["space_id"])
    log_ = JobLog(pool, job["id"])
    succeeded, error = True, None
    try:
        await HANDLERS[job["kind"]](pool, log_, space)
        await log_.step("Done")
    except (JobFailed, remote.RemoteError) as exc:
        succeeded, error = False, str(exc)
    except Exception as exc:
        log.exception("MMRAG job {} crashed", job["id"])
        succeeded, error = False, remote.redact(f"Unexpected error: {exc}")
    if error:
        await log_.step(f"FAILED: {error}")
    await log_.flush()
    await apply_outcome(pool, job, succeeded, error)
    log.info("MMRAG job {} {} {} {}", job["id"], job["kind"], space["slug"], "ok" if succeeded else f"failed: {error}")


async def claim_job(pool: asyncpg.Pool):
    return await pool.fetchrow(
        """
        UPDATE mmrag_jobs SET status = 'running', started_at = now()
        WHERE id = (
            SELECT id FROM mmrag_jobs WHERE status = 'queued'
            ORDER BY created_at ASC LIMIT 1
            FOR UPDATE SKIP LOCKED
        )
        RETURNING *
        """
    )


async def recover_interrupted(pool: asyncpg.Pool):
    """A job still 'running' at startup died with the previous process. setup.sh
    commands are safe to run again, so it is failed for an admin to retry."""
    rows = await pool.fetch("SELECT * FROM mmrag_jobs WHERE status = 'running'")
    for job in rows:
        log.warning("Recovering interrupted MMRAG job {}", job["id"])
        await apply_outcome(pool, job, False, "Interrupted by a worker restart")


async def main():
    log.info("MMRAG worker starting | poll_interval={}s configured={}", POLL_INTERVAL, remote.is_configured())
    pool = await asyncpg.create_pool(settings.DATABASE_URL, min_size=1, max_size=3)
    # Email helpers read SMTP config through database.get_db().
    database.pool = pool
    await recover_interrupted(pool)
    while True:
        try:
            job = await claim_job(pool)
            if job:
                await run_job(pool, job)
                continue
        except Exception:
            log.exception("MMRAG worker loop error")
        await asyncio.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    asyncio.run(main())
