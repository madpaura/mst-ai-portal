"""Admin side of MMRAG spaces: review, deployment, verification and operations."""
import asyncio
from datetime import datetime, timezone
from typing import Optional

import asyncpg
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request, Response

from auth.audit import audit
from auth.dependencies import require_admin
from config import settings
from database import get_db
from limiter import limiter
from mmrag import notify, remote
from mmrag.schemas import AdminDeleteRequest, NoteRequired, OptionalNote
from mmrag.service import (
    DELETABLE,
    REVIEWABLE,
    SPACE_SELECT,
    active_jobs,
    add_event,
    enqueue_job,
    fetch_space,
    iso,
    job_summary,
    list_events,
    row_to_space,
    save_monitoring,
    transition,
)

router = APIRouter()

# Statuses waiting on an admin, for the default queue view.
NEEDS_ACTION = ["pending", "deployed", "deploy_failed", "delete_requested", "delete_failed"]


async def _space_or_404(space_id: str):
    db = await get_db()
    try:
        row = await fetch_space(db, space_id)
    except asyncpg.DataError:
        row = None
    if row is None:
        raise HTTPException(status_code=404, detail="Space not found")
    return row


def _require_remote():
    if not remote.is_configured():
        raise HTTPException(
            status_code=503,
            detail="The mmrag host is not configured. Set the MMRAG_SSH_* and MMRAG_REMOTE_PATH variables first.",
        )


async def _detail(space_id) -> dict:
    db = await get_db()
    row = await fetch_space(db, space_id)
    jobs = await active_jobs(db, [row["id"]])
    history = await db.fetch(
        """
        SELECT id, kind, status, error, created_at, started_at, finished_at
        FROM mmrag_jobs WHERE space_id = $1 ORDER BY created_at DESC LIMIT 25
        """,
        row["id"],
    )
    return {
        **row_to_space(row, active_job=jobs.get(str(row["id"]))),
        "backup_path": row["backup_path"],
        "events": await list_events(db, str(row["id"])),
        "jobs": [
            {**job_summary(j), "error": j["error"], "finished_at": iso(j["finished_at"])}
            for j in history
        ],
    }


async def _queue_job(space, kind: str, admin: dict, event: str, note: Optional[str] = None):
    """Record the admin's request and queue a job without changing the status."""
    _require_remote()
    db = await get_db()
    async with db.acquire() as conn, conn.transaction():
        await enqueue_job(conn, space["id"], kind, admin)
        await add_event(conn, space["id"], event, admin, note)


# ── Queue and host connection ─────────────────────────────────────────────────

@router.get("")
async def list_spaces(
    filter: str = Query("action"),
    q: Optional[str] = Query(None, max_length=120),
    admin: dict = Depends(require_admin),
):
    db = await get_db()
    clauses, params = [], []
    if filter == "action":
        params.append(NEEDS_ACTION)
        clauses.append(f"s.status = ANY(${len(params)}::text[])")
    elif filter == "all":
        clauses.append("s.status <> 'deleted'")
    else:
        params.append(filter)
        clauses.append(f"s.status = ${len(params)}")
    if q:
        params.append(f"%{q}%")
        clauses.append(
            f"(s.name ILIKE ${len(params)} OR s.slug ILIKE ${len(params)} "
            f"OR s.plm_project ILIKE ${len(params)} OR u.display_name ILIKE ${len(params)})"
        )
    rows = await db.fetch(
        f"{SPACE_SELECT} WHERE {' AND '.join(clauses)} ORDER BY s.updated_at DESC LIMIT 200",
        *params,
    )
    jobs = await active_jobs(db, [r["id"] for r in rows])
    action_count = await db.fetchval(
        "SELECT COUNT(*) FROM mmrag_spaces WHERE status = ANY($1::text[])", NEEDS_ACTION,
    )
    return {
        "items": [row_to_space(r, active_job=jobs.get(str(r["id"]))) for r in rows],
        "action_count": action_count,
    }


@router.get("/connection")
async def connection(admin: dict = Depends(require_admin)):
    return {
        "configured": remote.is_configured(),
        "host": settings.MMRAG_SSH_HOST,
        "user": settings.MMRAG_SSH_USER,
        "remote_path": settings.MMRAG_REMOTE_PATH,
    }


@router.post("/connection/test")
async def test_connection(admin: dict = Depends(require_admin)):
    _require_remote()
    try:
        result = await remote.run(["check"], timeout=90)
    except remote.RemoteError as exc:
        return {"ok": False, "output": str(exc)}
    return {"ok": result.ok, "output": result.output}


@router.get("/jobs/{job_id}")
async def get_job(job_id: str, admin: dict = Depends(require_admin)):
    db = await get_db()
    try:
        row = await db.fetchrow("SELECT * FROM mmrag_jobs WHERE id = $1", job_id)
    except asyncpg.DataError:
        row = None
    if row is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return {
        **job_summary(row),
        "log": row["log"],
        "error": row["error"],
        "finished_at": iso(row["finished_at"]),
    }


@router.get("/{space_id}")
async def get_space(space_id: str, admin: dict = Depends(require_admin)):
    row = await _space_or_404(space_id)
    return await _detail(row["id"])


# ── Review ────────────────────────────────────────────────────────────────────

@router.post("/{space_id}/approve")
async def approve(space_id: str, request: Request, admin: dict = Depends(require_admin)):
    """First approval: queue the deployment on the mmrag host."""
    _require_remote()
    space = await _space_or_404(space_id)
    db = await get_db()
    async with db.acquire() as conn, conn.transaction():
        await transition(
            conn, space["id"], ("pending",), "deploying",
            review_note=None, reviewed_by=admin["id"], reviewed_at=datetime.now(timezone.utc),
        )
        await add_event(conn, space["id"], "approved", admin)
        await enqueue_job(conn, space["id"], "deploy", admin)
    await audit(request, admin, "mmrag_space.approved", "mmrag_space", space_id, {"slug": space["slug"]})
    return await _detail(space["id"])


async def _send_back(
    space_id: str, to_status: str, event: str, note: str, admin: dict,
    background: BackgroundTasks, request: Request, subject: str, heading: str, intro: str,
):
    space = await _space_or_404(space_id)
    db = await get_db()
    async with db.acquire() as conn, conn.transaction():
        await transition(
            conn, space["id"], REVIEWABLE, to_status,
            review_note=note, reviewed_by=admin["id"], reviewed_at=datetime.now(timezone.utc),
        )
        await add_event(conn, space["id"], event, admin, note)
        # Anything already deployed is removed so the host doesn't keep running a
        # stack nobody can reach. The slug stays until that job has finished.
        if space["provisioned"]:
            await enqueue_job(conn, space["id"], "teardown", admin)
    await audit(request, admin, f"mmrag_space.{event}", "mmrag_space", space_id, {"slug": space["slug"], "note": note})
    public = row_to_space(await fetch_space(db, space["id"]))
    background.add_task(notify.notify_owner, public, subject, heading, intro, note)
    return await _detail(space["id"])


@router.post("/{space_id}/request-info")
async def request_info(
    space_id: str, req: NoteRequired, request: Request, background: BackgroundTasks,
    admin: dict = Depends(require_admin),
):
    return await _send_back(
        space_id, "needs_info", "info_requested", req.note, admin, background, request,
        "MMRAG space: more information needed", "More information needed",
        "An admin needs more details before this space can go ahead. Edit your request and resubmit it from the portal.",
    )


@router.post("/{space_id}/reject")
async def reject(
    space_id: str, req: NoteRequired, request: Request, background: BackgroundTasks,
    admin: dict = Depends(require_admin),
):
    return await _send_back(
        space_id, "rejected", "rejected", req.note, admin, background, request,
        "MMRAG space request rejected", "Request rejected",
        "An admin rejected this request. You can edit and resubmit it, or delete it from the portal.",
    )


@router.post("/{space_id}/retry-cleanup")
async def retry_cleanup(space_id: str, request: Request, admin: dict = Depends(require_admin)):
    """Retry removing a deployment left behind by a failed teardown. The owner
    cannot delete the request until this has succeeded."""
    space = await _space_or_404(space_id)
    if space["status"] not in ("needs_info", "rejected") or not space["provisioned"]:
        raise HTTPException(status_code=409, detail="There is nothing to clean up for this space")
    await _queue_job(space, "teardown", admin, "cleanup_retried")
    await audit(request, admin, "mmrag_space.cleanup_retried", "mmrag_space", space_id, {"slug": space["slug"]})
    return await _detail(space["id"])


# ── Deployment and verification ───────────────────────────────────────────────

@router.post("/{space_id}/retry")
async def retry_deploy(space_id: str, request: Request, admin: dict = Depends(require_admin)):
    _require_remote()
    space = await _space_or_404(space_id)
    db = await get_db()
    async with db.acquire() as conn, conn.transaction():
        await transition(conn, space["id"], ("deploy_failed",), "deploying")
        await add_event(conn, space["id"], "deploy_retried", admin)
        await enqueue_job(conn, space["id"], "deploy", admin)
    await audit(request, admin, "mmrag_space.deploy_retried", "mmrag_space", space_id, {"slug": space["slug"]})
    return await _detail(space["id"])


@router.post("/{space_id}/final-approve")
async def final_approve(
    space_id: str, req: OptionalNote, request: Request, background: BackgroundTasks,
    admin: dict = Depends(require_admin),
):
    """Final approval after the admin has verified the deployment."""
    space = await _space_or_404(space_id)
    db = await get_db()
    async with db.acquire() as conn, conn.transaction():
        await transition(
            conn, space["id"], ("deployed",), "live",
            review_note=req.note or None, reviewed_by=admin["id"], reviewed_at=datetime.now(timezone.utc),
        )
        await add_event(conn, space["id"], "went_live", admin, req.note)
    await audit(request, admin, "mmrag_space.went_live", "mmrag_space", space_id, {"slug": space["slug"]})
    public = row_to_space(await fetch_space(db, space["id"]))
    background.add_task(
        notify.notify_owner, public, f"Your MMRAG space {public['name']} is ready",
        "Your space is ready",
        "Your MMRAG space passed verification. Open it from the portal, where you can also view its access key.",
        req.note,
    )
    return await _detail(space["id"])


# ── Operations ────────────────────────────────────────────────────────────────

@router.post("/{space_id}/status")
async def refresh_status(space_id: str, admin: dict = Depends(require_admin)):
    _require_remote()
    space = await _space_or_404(space_id)
    try:
        health, usage = await asyncio.gather(remote.check_health(space["slug"]), remote.check_usage(space["slug"]))
    except remote.RemoteError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    await save_monitoring(await get_db(), space["id"], health, usage)
    return await _detail(space["id"])


@router.post("/{space_id}/redeploy")
async def redeploy(space_id: str, request: Request, admin: dict = Depends(require_admin)):
    space = await _space_or_404(space_id)
    if space["status"] != "live":
        raise HTTPException(status_code=409, detail="Only a live space can be redeployed")
    await _queue_job(space, "redeploy", admin, "redeploy_requested")
    await audit(request, admin, "mmrag_space.redeploy", "mmrag_space", space_id, {"slug": space["slug"]})
    return await _detail(space["id"])


@router.post("/{space_id}/stop")
async def stop(space_id: str, request: Request, admin: dict = Depends(require_admin)):
    space = await _space_or_404(space_id)
    if space["status"] != "live":
        raise HTTPException(status_code=409, detail="Only a live space can be stopped")
    await _queue_job(space, "stop", admin, "stop_requested")
    await audit(request, admin, "mmrag_space.stop", "mmrag_space", space_id, {"slug": space["slug"]})
    return await _detail(space["id"])


@router.post("/{space_id}/start")
async def start(space_id: str, request: Request, admin: dict = Depends(require_admin)):
    space = await _space_or_404(space_id)
    if space["status"] != "stopped":
        raise HTTPException(status_code=409, detail="Only a stopped space can be started")
    await _queue_job(space, "start", admin, "start_requested")
    await audit(request, admin, "mmrag_space.start", "mmrag_space", space_id, {"slug": space["slug"]})
    return await _detail(space["id"])


@router.post("/{space_id}/rotate-key")
async def rotate_key(space_id: str, request: Request, admin: dict = Depends(require_admin)):
    space = await _space_or_404(space_id)
    if space["status"] != "live":
        raise HTTPException(status_code=409, detail="Only a live space can have its key rotated")
    await _queue_job(space, "rotate_key", admin, "key_rotation_requested")
    await audit(request, admin, "mmrag_space.rotate_key", "mmrag_space", space_id, {"slug": space["slug"]})
    return await _detail(space["id"])


@router.post("/{space_id}/reveal-key")
@limiter.limit("10/minute")
async def reveal_key(
    request: Request, response: Response, space_id: str, admin: dict = Depends(require_admin),
):
    """Admins need the key to open the space during verification."""
    _require_remote()
    space = await _space_or_404(space_id)
    if space["status"] not in ("deployed", "live"):
        raise HTTPException(status_code=409, detail="The space is not deployed")
    try:
        key = await remote.fetch_key(space["slug"])
    except remote.RemoteError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    await audit(request, admin, "mmrag_space.key_revealed", "mmrag_space", space_id, {"slug": space["slug"]})
    response.headers["Cache-Control"] = "no-store"
    return {"username": space["slug"], "key": key}


# ── Deletion ──────────────────────────────────────────────────────────────────

@router.post("/{space_id}/delete")
async def admin_delete(
    space_id: str, req: AdminDeleteRequest, request: Request, background: BackgroundTasks,
    admin: dict = Depends(require_admin),
):
    """Delete a space without an owner request. The space ID has to be repeated
    in the request, because this can't be undone."""
    space = await _space_or_404(space_id)
    if req.slug != space["slug"]:
        raise HTTPException(status_code=422, detail="The space ID doesn't match")
    db = await get_db()
    if space["provisioned"]:
        _require_remote()
        async with db.acquire() as conn, conn.transaction():
            await transition(
                conn, space["id"], DELETABLE, "deleting",
                pre_delete_status=space["status"], delete_reason=req.reason, reviewed_by=admin["id"],
            )
            await add_event(conn, space["id"], "admin_delete_started", admin, req.reason)
            await enqueue_job(conn, space["id"], "destroy", admin)
    else:
        async with db.acquire() as conn, conn.transaction():
            await transition(conn, space["id"], DELETABLE, "deleted", delete_reason=req.reason, reviewed_by=admin["id"])
            await add_event(conn, space["id"], "deleted_by_admin", admin, req.reason)
        public = row_to_space(await fetch_space(db, space["id"]))
        background.add_task(
            notify.notify_owner, public, f"MMRAG space deleted: {public['name']}", "Space deleted",
            "An admin deleted this space request.", req.reason,
        )
    await audit(request, admin, "mmrag_space.admin_deleted", "mmrag_space", space_id, {"slug": space["slug"], "reason": req.reason})
    return await _detail(space["id"])


@router.post("/{space_id}/approve-delete")
async def approve_delete(space_id: str, request: Request, admin: dict = Depends(require_admin)):
    _require_remote()
    space = await _space_or_404(space_id)
    db = await get_db()
    async with db.acquire() as conn, conn.transaction():
        await transition(conn, space["id"], ("delete_requested",), "deleting", reviewed_by=admin["id"])
        await add_event(conn, space["id"], "delete_approved", admin)
        await enqueue_job(conn, space["id"], "destroy", admin)
    await audit(request, admin, "mmrag_space.delete_approved", "mmrag_space", space_id, {"slug": space["slug"]})
    return await _detail(space["id"])


@router.post("/{space_id}/deny-delete")
async def deny_delete(
    space_id: str, req: NoteRequired, request: Request, background: BackgroundTasks,
    admin: dict = Depends(require_admin),
):
    space = await _space_or_404(space_id)
    db = await get_db()
    async with db.acquire() as conn, conn.transaction():
        await transition(
            conn, space["id"], ("delete_requested",), space["pre_delete_status"] or "live",
            delete_reason=None, pre_delete_status=None, review_note=req.note,
        )
        await add_event(conn, space["id"], "delete_denied", admin, req.note)
    await audit(request, admin, "mmrag_space.delete_denied", "mmrag_space", space_id, {"slug": space["slug"], "note": req.note})
    public = row_to_space(await fetch_space(db, space["id"]))
    background.add_task(
        notify.notify_owner, public, f"MMRAG space deletion declined: {public['name']}",
        "Deletion declined", "An admin declined the request to delete this space. It stays as it was.", req.note,
    )
    return await _detail(space["id"])


@router.post("/{space_id}/retry-delete")
async def retry_delete(space_id: str, request: Request, admin: dict = Depends(require_admin)):
    _require_remote()
    space = await _space_or_404(space_id)
    db = await get_db()
    async with db.acquire() as conn, conn.transaction():
        await transition(conn, space["id"], ("delete_failed",), "deleting")
        await add_event(conn, space["id"], "delete_retried", admin)
        await enqueue_job(conn, space["id"], "destroy", admin)
    await audit(request, admin, "mmrag_space.delete_retried", "mmrag_space", space_id, {"slug": space["slug"]})
    return await _detail(space["id"])


@router.post("/{space_id}/force-remove")
async def force_remove(
    space_id: str, req: NoteRequired, request: Request, admin: dict = Depends(require_admin),
):
    """Drop the portal record after a failed delete, e.g. when the project was
    already removed by hand. Runs nothing on the mmrag host."""
    space = await _space_or_404(space_id)
    db = await get_db()
    async with db.acquire() as conn, conn.transaction():
        await transition(conn, space["id"], ("delete_failed",), "deleted", provisioned=False)
        await add_event(conn, space["id"], "force_removed", admin, req.note)
    await audit(request, admin, "mmrag_space.force_removed", "mmrag_space", space_id, {"slug": space["slug"], "note": req.note})
    return await _detail(space["id"])
