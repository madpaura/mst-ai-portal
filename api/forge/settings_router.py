from fastapi import APIRouter, HTTPException, Depends, BackgroundTasks

from forge.settings_schemas import (
    ForgeSettingResponse, ForgeSettingCreate, ForgeSettingUpdate,
    ForgeSyncJobResponse,
)
from auth.dependencies import require_admin
from database import get_db
from config import settings as app_settings

router = APIRouter()


def _mask_token(token: str | None) -> str | None:
    if not token:
        return None
    if len(token) <= 8:
        return "****"
    return token[:4] + "****" + token[-4:]


def _row_to_setting(r) -> ForgeSettingResponse:
    return ForgeSettingResponse(
        id=str(r["id"]),
        git_url=r["git_url"],
        git_token=_mask_token(r.get("git_token")),
        git_branch=r["git_branch"],
        scan_paths=list(r["scan_paths"]) if r["scan_paths"] else ["."],
        update_frequency=r["update_frequency"],
        llm_provider=r["llm_provider"],
        llm_model=r["llm_model"],
        llm_api_key=_mask_token(r.get("llm_api_key")),
        auto_update_release_tag=r["auto_update_release_tag"],
        is_active=r["is_active"],
        created_at=r["created_at"],
        updated_at=r["updated_at"],
    )


# ── Settings CRUD ─────────────────────────────────────────

@router.get("/settings", response_model=list[ForgeSettingResponse])
async def list_settings(admin: dict = Depends(require_admin)):
    db = await get_db()
    rows = await db.fetch("SELECT * FROM forge_settings ORDER BY created_at DESC")
    return [_row_to_setting(r) for r in rows]


@router.post("/settings", response_model=ForgeSettingResponse)
async def create_setting(req: ForgeSettingCreate, admin: dict = Depends(require_admin)):
    db = await get_db()
    row = await db.fetchrow(
        """
        INSERT INTO forge_settings
            (git_url, git_token, git_branch, scan_paths, update_frequency,
             llm_provider, llm_model, llm_api_key, auto_update_release_tag)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        RETURNING *
        """,
        req.git_url, req.git_token, req.git_branch, req.scan_paths,
        req.update_frequency, req.llm_provider, req.llm_model,
        req.llm_api_key, req.auto_update_release_tag,
    )
    return _row_to_setting(row)


@router.get("/settings/{setting_id}", response_model=ForgeSettingResponse)
async def get_setting(setting_id: str, admin: dict = Depends(require_admin)):
    db = await get_db()
    row = await db.fetchrow("SELECT * FROM forge_settings WHERE id = $1", setting_id)
    if not row:
        raise HTTPException(status_code=404, detail="Setting not found")
    return _row_to_setting(row)


@router.put("/settings/{setting_id}", response_model=ForgeSettingResponse)
async def update_setting(
    setting_id: str, req: ForgeSettingUpdate, admin: dict = Depends(require_admin)
):
    db = await get_db()
    existing = await db.fetchrow("SELECT * FROM forge_settings WHERE id = $1", setting_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Setting not found")

    fields = {}
    for field in [
        "git_url", "git_token", "git_branch", "scan_paths", "update_frequency",
        "llm_provider", "llm_model", "llm_api_key", "auto_update_release_tag", "is_active",
    ]:
        val = getattr(req, field, None)
        if val is not None:
            fields[field] = val

    if fields:
        set_parts = []
        params = [setting_id]
        idx = 2
        for k, v in fields.items():
            set_parts.append(f"{k} = ${idx}")
            params.append(v)
            idx += 1
        set_parts.append("updated_at = now()")
        set_clause = ", ".join(set_parts)
        await db.execute(f"UPDATE forge_settings SET {set_clause} WHERE id = $1", *params)

    row = await db.fetchrow("SELECT * FROM forge_settings WHERE id = $1", setting_id)
    return _row_to_setting(row)


@router.delete("/settings/{setting_id}")
async def delete_setting(setting_id: str, admin: dict = Depends(require_admin)):
    db = await get_db()
    result = await db.execute("DELETE FROM forge_settings WHERE id = $1", setting_id)
    if result == "DELETE 0":
        raise HTTPException(status_code=404, detail="Setting not found")
    return {"message": "Setting deleted"}


# ── Sync Jobs ─────────────────────────────────────────────

@router.get("/settings/{setting_id}/jobs", response_model=list[ForgeSyncJobResponse])
async def list_sync_jobs(setting_id: str, admin: dict = Depends(require_admin)):
    db = await get_db()
    rows = await db.fetch(
        "SELECT * FROM forge_sync_jobs WHERE settings_id = $1 ORDER BY created_at DESC LIMIT 20",
        setting_id,
    )
    return [
        ForgeSyncJobResponse(
            id=r["id"], settings_id=str(r["settings_id"]),
            trigger_type=r["trigger_type"], status=r["status"],
            components_found=r["components_found"],
            components_updated=r["components_updated"],
            components_created=r["components_created"],
            error=r.get("error"),
            started_at=r.get("started_at"),
            completed_at=r.get("completed_at"),
            created_at=r["created_at"],
        )
        for r in rows
    ]


@router.post("/settings/{setting_id}/sync")
async def trigger_sync(
    setting_id: str,
    background_tasks: BackgroundTasks,
    admin: dict = Depends(require_admin),
):
    db = await get_db()
    setting = await db.fetchrow("SELECT * FROM forge_settings WHERE id = $1", setting_id)
    if not setting:
        raise HTTPException(status_code=404, detail="Setting not found")

    row = await db.fetchrow(
        "INSERT INTO forge_sync_jobs (settings_id, trigger_type) VALUES ($1, 'manual') RETURNING id",
        setting_id,
    )
    from forge.sync_worker import run_sync_job
    background_tasks.add_task(run_sync_job, row["id"], app_settings.DATABASE_URL)
    return {"message": "Sync job started", "job_id": row["id"]}


@router.post("/sync-all")
async def trigger_sync_all(
    background_tasks: BackgroundTasks,
    admin: dict = Depends(require_admin),
):
    db = await get_db()
    settings = await db.fetch("SELECT id FROM forge_settings WHERE is_active = true")
    job_ids = []
    for s in settings:
        row = await db.fetchrow(
            "INSERT INTO forge_sync_jobs (settings_id, trigger_type) VALUES ($1, 'manual') RETURNING id",
            s["id"],
        )
        job_ids.append(row["id"])
        from forge.sync_worker import run_sync_job
        background_tasks.add_task(run_sync_job, row["id"], app_settings.DATABASE_URL)
    return {"message": f"Sync jobs started for {len(job_ids)} settings", "job_ids": job_ids}
