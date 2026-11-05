"""Space requests from the owner's side. Other people's spaces read as 404."""
import asyncpg
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, Response

from auth.audit import audit
from auth.dependencies import get_current_user
from database import get_db
from limiter import limiter
from mmrag import notify, remote
from mmrag.schemas import DeleteRequest, SpaceFields
from mmrag.service import (
    EDITABLE,
    RESUBMITTABLE,
    SPACE_SELECT,
    active_jobs,
    add_event,
    fetch_space,
    list_events,
    row_to_space,
    slugify,
    transition,
)

router = APIRouter()


async def _own_space(space_id: str, user: dict):
    db = await get_db()
    try:
        row = await fetch_space(db, space_id)
    except asyncpg.DataError:
        row = None
    if row is None or row["owner_id"] != user["id"] or row["status"] == "deleted":
        raise HTTPException(status_code=404, detail="Space not found")
    return row


def _resolve_slug(req: SpaceFields) -> str:
    slug = req.slug or slugify(req.name)
    if not remote.SLUG_RE.match(slug):
        raise HTTPException(status_code=422, detail="Choose a space ID: the name has no usable letters or digits")
    return slug


_SLUG_TAKEN = "This space ID is already taken. Choose another one."


@router.get("")
async def list_spaces(user: dict = Depends(get_current_user)):
    db = await get_db()
    rows = await db.fetch(
        f"{SPACE_SELECT} WHERE s.owner_id = $1 AND s.status <> 'deleted' ORDER BY s.created_at DESC",
        user["id"],
    )
    jobs = await active_jobs(db, [r["id"] for r in rows])
    return {"items": [row_to_space(r, active_job=jobs.get(str(r["id"]))) for r in rows]}


@router.post("", status_code=201)
async def create_space(req: SpaceFields, background: BackgroundTasks, user: dict = Depends(get_current_user)):
    db = await get_db()
    slug = _resolve_slug(req)
    try:
        async with db.acquire() as conn, conn.transaction():
            row = await conn.fetchrow(
                """
                INSERT INTO mmrag_spaces (slug, name, plm_project, reason, owner_id)
                VALUES ($1, $2, $3, $4, $5) RETURNING id
                """,
                slug, req.name, req.plm_project, req.reason, user["id"],
            )
            await add_event(conn, row["id"], "requested", user)
    except asyncpg.UniqueViolationError:
        raise HTTPException(status_code=409, detail=_SLUG_TAKEN)

    space = row_to_space(await fetch_space(db, row["id"]))
    background.add_task(
        notify.notify_reviewers, space, f"MMRAG space request: {space['name']}",
        "New MMRAG space request", f"{user['display_name']} requested a new space.", space["reason"],
    )
    return space


@router.get("/{space_id}")
async def get_space(space_id: str, user: dict = Depends(get_current_user)):
    row = await _own_space(space_id, user)
    db = await get_db()
    jobs = await active_jobs(db, [row["id"]])
    return {**row_to_space(row, active_job=jobs.get(str(row["id"]))), "events": await list_events(db, space_id)}


@router.put("/{space_id}")
async def update_space(space_id: str, req: SpaceFields, user: dict = Depends(get_current_user)):
    current = await _own_space(space_id, user)
    # A provisioned project is named after its slug on the mmrag host, and the
    # teardown that follows a send-back may still be queued.
    slug = current["slug"] if current["provisioned"] else _resolve_slug(req)
    db = await get_db()
    try:
        row = await db.fetchrow(
            """
            UPDATE mmrag_spaces
            SET slug = $3, name = $4, plm_project = $5, reason = $6, updated_at = now()
            WHERE id = $1 AND status = ANY($2::text[])
            RETURNING id
            """,
            current["id"], list(EDITABLE), slug, req.name, req.plm_project, req.reason,
        )
    except asyncpg.UniqueViolationError:
        raise HTTPException(status_code=409, detail=_SLUG_TAKEN)
    if row is None:
        raise HTTPException(status_code=409, detail="This request can no longer be edited")
    return row_to_space(await fetch_space(db, current["id"]))


@router.post("/{space_id}/resubmit")
async def resubmit_space(space_id: str, background: BackgroundTasks, user: dict = Depends(get_current_user)):
    current = await _own_space(space_id, user)
    db = await get_db()
    async with db.acquire() as conn, conn.transaction():
        await transition(conn, current["id"], RESUBMITTABLE, "pending", review_note=None)
        await add_event(conn, current["id"], "resubmitted", user)
    space = row_to_space(await fetch_space(db, current["id"]))
    background.add_task(
        notify.notify_reviewers, space, f"MMRAG space resubmitted: {space['name']}",
        "MMRAG space resubmitted", f"{user['display_name']} updated and resubmitted this request.", space["reason"],
    )
    return space


@router.delete("/{space_id}", status_code=204)
async def delete_request(space_id: str, user: dict = Depends(get_current_user)):
    """Delete a request that never went live. Live spaces go through request-delete."""
    current = await _own_space(space_id, user)
    if current["provisioned"]:
        raise HTTPException(status_code=409, detail="The earlier deployment is still being removed. Try again shortly.")
    db = await get_db()
    async with db.acquire() as conn, conn.transaction():
        await transition(conn, current["id"], EDITABLE, "deleted")
        await add_event(conn, current["id"], "deleted_by_owner", user)


@router.post("/{space_id}/request-delete")
async def request_delete(
    space_id: str, req: DeleteRequest, background: BackgroundTasks, user: dict = Depends(get_current_user),
):
    current = await _own_space(space_id, user)
    db = await get_db()
    if await active_jobs(db, [current["id"]]):
        raise HTTPException(status_code=409, detail="An admin job is running on this space. Try again when it finishes.")
    async with db.acquire() as conn, conn.transaction():
        await transition(
            conn, current["id"], ("live", "stopped"), "delete_requested",
            delete_reason=req.reason, pre_delete_status=current["status"],
        )
        await add_event(conn, current["id"], "delete_requested", user, req.reason)
    space = row_to_space(await fetch_space(db, current["id"]))
    background.add_task(
        notify.notify_reviewers, space, f"MMRAG space deletion requested: {space['name']}",
        "Deletion requested", f"{user['display_name']} asked to delete this space.", req.reason,
    )
    return space


@router.post("/{space_id}/cancel-delete")
async def cancel_delete(space_id: str, user: dict = Depends(get_current_user)):
    current = await _own_space(space_id, user)
    db = await get_db()
    async with db.acquire() as conn, conn.transaction():
        await transition(
            conn, current["id"], ("delete_requested",), current["pre_delete_status"] or "live",
            delete_reason=None, pre_delete_status=None,
        )
        await add_event(conn, current["id"], "delete_cancelled", user)
    return row_to_space(await fetch_space(db, current["id"]))


@router.post("/{space_id}/reveal-key")
@limiter.limit("10/minute")
async def reveal_key(
    request: Request, response: Response, space_id: str, user: dict = Depends(get_current_user),
):
    current = await _own_space(space_id, user)
    if current["status"] != "live":
        raise HTTPException(status_code=409, detail="The access key is available once the space is live")
    try:
        key = await remote.fetch_key(current["slug"])
    except remote.RemoteError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    await audit(request, user, "mmrag_space.key_revealed", "mmrag_space", str(current["id"]), {"slug": current["slug"]})
    response.headers["Cache-Control"] = "no-store"
    return {"username": current["slug"], "key": key}
