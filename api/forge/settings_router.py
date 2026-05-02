from fastapi import APIRouter, HTTPException, Depends, BackgroundTasks
import os
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
        ollama_url=r.get("ollama_url"),
        auto_update_release_tag=r["auto_update_release_tag"],
        transcript_service_url=r.get("transcript_service_url"),
        transcript_service_api_key=_mask_token(r.get("transcript_service_api_key")),
        transcript_model=r.get("transcript_model") or "large-v3",
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
             llm_provider, llm_model, llm_api_key, ollama_url, auto_update_release_tag,
             transcript_service_url, transcript_service_api_key, transcript_model)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
        RETURNING *
        """,
        req.git_url, req.git_token, req.git_branch, req.scan_paths,
        req.update_frequency, req.llm_provider, req.llm_model,
        req.llm_api_key, req.ollama_url, req.auto_update_release_tag,
        req.transcript_service_url, req.transcript_service_api_key, req.transcript_model,
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
        "llm_provider", "llm_model", "llm_api_key", "ollama_url", "auto_update_release_tag", "is_active",
        "transcript_service_url", "transcript_service_api_key", "transcript_model",
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
            log=r.get("log"),
            started_at=r.get("started_at"),
            completed_at=r.get("completed_at"),
            created_at=r["created_at"],
        )
        for r in rows
    ]


@router.post("/settings/{setting_id}/verify")
async def verify_setting(setting_id: str, admin: dict = Depends(require_admin)):
    """Check git access, permissions, and LLM connectivity for a setting."""
    db = await get_db()
    row = await db.fetchrow("SELECT * FROM forge_settings WHERE id = $1", setting_id)
    if not row:
        raise HTTPException(status_code=404, detail="Setting not found")

    results: dict = {"git": None, "llm": None}

    # ── Git check ────────────────────────────────────────
    import asyncio, subprocess
    git_url = row["git_url"]
    git_token = row.get("git_token")
    if git_token and "github.com" in git_url:
        auth_url = git_url.replace("https://", f"https://x-access-token:{git_token}@")
    elif git_token and "gitlab" in git_url:
        auth_url = git_url.replace("https://", f"https://oauth2:{git_token}@")
    elif git_token:
        auth_url = git_url.replace("https://", f"https://{git_token}@")
    else:
        auth_url = git_url

    try:
        git_env = {**os.environ, "GIT_TERMINAL_PROMPT": "0", "GIT_SSL_NO_VERIFY": "true"}
        proc = await asyncio.create_subprocess_exec(
            "git", "ls-remote", "--heads", auth_url,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            env=git_env,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=15)
        if proc.returncode == 0:
            branches = [l.split("\t")[-1].replace("refs/heads/", "") for l in stdout.decode().strip().split("\n") if l.strip()]
            target_branch = row["git_branch"]
            if target_branch in branches:
                results["git"] = {"status": "ok", "message": f"Repository accessible. Branch '{target_branch}' found.", "branches": branches[:10]}
            else:
                results["git"] = {"status": "warning", "message": f"Repository accessible but branch '{target_branch}' not found. Available: {', '.join(branches[:5])}", "branches": branches[:10]}
        else:
            results["git"] = {"status": "error", "message": f"Git access failed: {stderr.decode().strip()[:200]}"}
    except asyncio.TimeoutError:
        results["git"] = {"status": "error", "message": "Git connection timed out after 15s"}
    except Exception as e:
        results["git"] = {"status": "error", "message": f"Git check error: {str(e)[:200]}"}

    # ── LLM check ────────────────────────────────────────
    llm_provider = row["llm_provider"]
    llm_model = row["llm_model"]
    llm_key = row.get("llm_api_key")

    if llm_provider == "ollama":
        import httpx
        ollama_base_url = (row.get("ollama_url") or app_settings.OLLAMA_BASE_URL).rstrip("/")
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.get(f"{ollama_base_url}/api/tags")
                if resp.status_code == 200:
                    models = [m["name"] for m in resp.json().get("models", [])]
                    if any(llm_model in m for m in models):
                        results["llm"] = {"status": "ok", "message": f"Ollama running. Model '{llm_model}' available."}
                    else:
                        results["llm"] = {"status": "warning", "message": f"Ollama running but model '{llm_model}' not found. Available: {', '.join(models[:5])}"}
                else:
                    results["llm"] = {"status": "error", "message": f"Ollama returned status {resp.status_code}"}
        except Exception as e:
            results["llm"] = {"status": "error", "message": f"Cannot reach Ollama at {ollama_base_url}: {str(e)[:150]}"}
    elif llm_key:
        import httpx
        try:
            if llm_provider == "openai":
                async with httpx.AsyncClient(timeout=10) as client:
                    resp = await client.get(
                        "https://api.openai.com/v1/models",
                        headers={"Authorization": f"Bearer {llm_key}"},
                    )
                    if resp.status_code == 200:
                        models = [m["id"] for m in resp.json().get("data", [])]
                        if llm_model in models:
                            results["llm"] = {"status": "ok", "message": f"OpenAI key valid. Model '{llm_model}' available."}
                        else:
                            results["llm"] = {"status": "warning", "message": f"OpenAI key valid but model '{llm_model}' not in account. Check model name."}
                    elif resp.status_code == 401:
                        results["llm"] = {"status": "error", "message": "OpenAI API key is invalid or expired."}
                    else:
                        results["llm"] = {"status": "error", "message": f"OpenAI returned status {resp.status_code}: {resp.text[:150]}"}
            elif llm_provider == "anthropic":
                async with httpx.AsyncClient(timeout=10) as client:
                    resp = await client.post(
                        "https://api.anthropic.com/v1/messages",
                        headers={"x-api-key": llm_key, "anthropic-version": "2023-06-01", "content-type": "application/json"},
                        json={"model": llm_model, "max_tokens": 1, "messages": [{"role": "user", "content": "hi"}]},
                    )
                    if resp.status_code == 200:
                        results["llm"] = {"status": "ok", "message": f"Anthropic key valid. Model '{llm_model}' responded."}
                    elif resp.status_code == 401:
                        results["llm"] = {"status": "error", "message": "Anthropic API key is invalid."}
                    else:
                        results["llm"] = {"status": "warning", "message": f"Anthropic returned {resp.status_code}: {resp.text[:150]}"}
            else:
                results["llm"] = {"status": "warning", "message": f"Unknown LLM provider '{llm_provider}'. Cannot verify."}
        except Exception as e:
            results["llm"] = {"status": "error", "message": f"LLM check error: {str(e)[:200]}"}
    else:
        results["llm"] = {"status": "warning", "message": "No LLM API key configured. LLM features will not work."}

    return results


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
