"""State machine shared by the user router, the admin router and the worker.

Lifecycle:
  pending -> deploying -> deployed -> live <-> stopped
  pending | deployed | deploy_failed -> needs_info | rejected -> pending
  deploying -> deploy_failed -> deploying
  live | stopped -> delete_requested -> deleting -> deleted
  deleting -> delete_failed -> deleting | deleted
"""
import json
import re
from typing import Optional

import asyncpg
from fastapi import HTTPException

# Statuses in which the owner may still change the request.
EDITABLE = ("pending", "needs_info", "rejected")
RESUBMITTABLE = ("needs_info", "rejected")
# Statuses the admin can send back to the owner.
REVIEWABLE = ("pending", "deployed", "deploy_failed")

JOB_LABELS = {
    "deploy": "Deploy",
    "redeploy": "Redeploy",
    "start": "Start",
    "stop": "Stop",
    "rotate_key": "Rotate key",
    "destroy": "Backup and delete",
    "teardown": "Remove deployment",
}


def slugify(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return slug[:31].rstrip("-")


def actor_name(user: Optional[dict]) -> Optional[str]:
    if not user:
        return None
    return user.get("display_name") or user.get("username")


def iso(value) -> Optional[str]:
    return value.isoformat() if value else None


def row_to_space(row, *, active_job: Optional[dict] = None) -> dict:
    health = row["health"]
    return {
        "id": str(row["id"]),
        "slug": row["slug"],
        "name": row["name"],
        "plm_project": row["plm_project"],
        "reason": row["reason"],
        "status": row["status"],
        "review_note": row["review_note"],
        "delete_reason": row["delete_reason"],
        "provisioned": row["provisioned"],
        "api_url": row["api_url"],
        "mgmt_url": row["mgmt_url"],
        "owner_id": str(row["owner_id"]) if row["owner_id"] else None,
        "owner_name": row["owner_name"],
        "owner_email": row["owner_email"],
        "health": json.loads(health) if isinstance(health, str) else health,
        "health_checked_at": iso(row["health_checked_at"]),
        "reviewed_at": iso(row["reviewed_at"]),
        "created_at": iso(row["created_at"]),
        "updated_at": iso(row["updated_at"]),
        "active_job": active_job,
    }


SPACE_SELECT = """
    SELECT s.*, u.display_name AS owner_name, u.email AS owner_email
    FROM mmrag_spaces s
    LEFT JOIN users u ON u.id = s.owner_id
"""


async def fetch_space(db, space_id: str):
    return await db.fetchrow(f"{SPACE_SELECT} WHERE s.id = $1", space_id)


async def add_event(conn, space_id, event: str, user: Optional[dict] = None, note: Optional[str] = None):
    await conn.execute(
        """
        INSERT INTO mmrag_space_events (space_id, actor_id, actor_name, event, note)
        VALUES ($1, $2, $3, $4, $5)
        """,
        space_id, user["id"] if user else None, actor_name(user), event, note,
    )


async def transition(conn, space_id, from_states, to_status: str, **fields):
    """Move a space between states, or raise 409 if it is no longer in `from_states`.

    The WHERE clause is what makes approvals safe against double clicks and two
    admins acting at the same time.
    """
    columns = list(fields)
    assignments = "".join(f", {column} = ${i + 4}" for i, column in enumerate(columns))
    row = await conn.fetchrow(
        f"""
        UPDATE mmrag_spaces SET status = $3, updated_at = now(){assignments}
        WHERE id = $1 AND status = ANY($2::text[])
        RETURNING *
        """,
        space_id, list(from_states), to_status, *fields.values(),
    )
    if row is None:
        raise HTTPException(status_code=409, detail="This space changed in the meantime. Refresh and try again.")
    return row


async def enqueue_job(conn, space_id, kind: str, user: Optional[dict] = None) -> str:
    try:
        return str(await conn.fetchval(
            "INSERT INTO mmrag_jobs (space_id, kind, requested_by) VALUES ($1, $2, $3) RETURNING id",
            space_id, kind, user["id"] if user else None,
        ))
    except asyncpg.UniqueViolationError:
        raise HTTPException(status_code=409, detail="Another job is still running for this space. Try again when it finishes.")


async def active_jobs(db, space_ids: list) -> dict:
    if not space_ids:
        return {}
    rows = await db.fetch(
        """
        SELECT id, space_id, kind, status, created_at, started_at
        FROM mmrag_jobs
        WHERE space_id = ANY($1::uuid[]) AND status IN ('queued', 'running')
        """,
        space_ids,
    )
    return {str(r["space_id"]): job_summary(r) for r in rows}


def job_summary(row) -> dict:
    return {
        "id": str(row["id"]),
        "kind": row["kind"],
        "label": JOB_LABELS.get(row["kind"], row["kind"]),
        "status": row["status"],
        "created_at": iso(row["created_at"]),
        "started_at": iso(row["started_at"]),
    }


async def list_events(db, space_id: str) -> list[dict]:
    rows = await db.fetch(
        """
        SELECT event, note, actor_name, created_at FROM mmrag_space_events
        WHERE space_id = $1 ORDER BY created_at DESC
        """,
        space_id,
    )
    return [
        {"event": r["event"], "note": r["note"], "actor_name": r["actor_name"], "created_at": iso(r["created_at"])}
        for r in rows
    ]
