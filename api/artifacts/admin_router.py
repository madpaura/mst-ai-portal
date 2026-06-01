import json
from typing import Optional
from fastapi import APIRouter, HTTPException, Depends, Query, BackgroundTasks

from artifacts.schemas import (
    ArtifactSubmissionCreate,
    ArtifactSubmissionUpdate,
    ArtifactSubmissionResponse,
    ArtifactFile,
    ValidationResult,
    ValidationIssue,
    ArtifactGithubConfig,
    ArtifactGithubTypeConfig,
    ArtifactAnalyzeRequest,
    ArtifactAnalyzeResponse,
)
from artifacts.validator import validate_files
from artifacts.github_client import push_artifact, test_connection
from auth.dependencies import require_admin, require_content, get_current_user
from database import get_db
from publish.router import _notify_reviewers
from email_utils.utils import send_email_multi
from config import settings
from loguru import logger as log

router = APIRouter()

_SETTINGS_KEY = "artifact_github_config"

# ── Helpers ───────────────────────────────────────────────────────────────────

def _row_to_response(row, submitter_name: Optional[str] = None) -> ArtifactSubmissionResponse:
    files_raw = row["files"] if isinstance(row["files"], list) else json.loads(row["files"] or "[]")
    files = [ArtifactFile(name=f["name"], content=f["content"]) for f in files_raw]

    val_raw = row["validation_results"]
    validation_results = None
    if val_raw:
        vd = val_raw if isinstance(val_raw, dict) else json.loads(val_raw)
        validation_results = ValidationResult(
            passed=vd.get("passed", False),
            errors=[ValidationIssue(**e) for e in vd.get("errors", [])],
            warnings=[ValidationIssue(**w) for w in vd.get("warnings", [])],
        )

    tags = row["tags"] or []

    return ArtifactSubmissionResponse(
        id=str(row["id"]),
        name=row["name"],
        display_name=row["display_name"],
        artifact_type=row["artifact_type"],
        description=row.get("description"),
        instructions=row.get("instructions"),
        files=files,
        tags=list(tags),
        status=row["status"],
        validation_results=validation_results,
        submitted_by_id=str(row["submitted_by"]) if row.get("submitted_by") else None,
        submitted_by_name=submitter_name,
        reviewed_by_id=str(row["reviewed_by"]) if row.get("reviewed_by") else None,
        github_url=row.get("github_url"),
        reject_reason=row.get("reject_reason"),
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


async def _load_github_config(db) -> dict:
    row = await db.fetchrow("SELECT value FROM app_settings WHERE key = $1", _SETTINGS_KEY)
    if not row:
        return {"agent": {}, "skill": {}, "mcp": {}}
    return json.loads(row["value"])


async def _save_github_config(db, config: dict):
    await db.execute(
        """
        INSERT INTO app_settings (key, value)
        VALUES ($1, $2)
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
        """,
        _SETTINGS_KEY,
        json.dumps(config),
    )


def _mask_config(config: dict) -> dict:
    masked = {}
    for atype, cfg in config.items():
        masked[atype] = {**cfg, "token": "••••••••" if cfg.get("token") else ""}
    return masked


# ── GitHub Config (admin only) ────────────────────────────────────────────────

@router.get("/artifacts/github-config")
async def get_github_config(admin: dict = Depends(require_admin)):
    db = await get_db()
    config = await _load_github_config(db)
    return _mask_config(config)


@router.post("/artifacts/analyze", response_model=ArtifactAnalyzeResponse)
async def analyze_artifact_files(
    req: ArtifactAnalyzeRequest,
    user: dict = Depends(require_content),
):
    """Use LLM to generate display_name, description and instructions from uploaded files."""
    from articles.llm import call_llm
    import json as _json

    files = req.files
    zip_name = req.zip_name

    # ── Find how-to / README file ──────────────────────────────────────────────
    HOWTO_NAMES = {"skill.md", "readme.md", "howto.md", "how_to.md", "guide.md", "usage.md"}
    howto_content: Optional[str] = None
    for f in files:
        fname = f.name.split("/")[-1].lower()
        if fname in HOWTO_NAMES:
            howto_content = f.content
            break

    # ── Build code context (non-markdown files, truncated) ────────────────────
    MAX_CONTEXT_CHARS = 6000
    code_snippets: list[str] = []
    chars = 0
    for f in files:
        if f.name.lower().endswith((".md", ".txt", ".rst")):
            continue
        preview = f.content[:800]
        code_snippets.append(f"### {f.name}\n```\n{preview}\n```")
        chars += len(preview)
        if chars >= MAX_CONTEXT_CHARS:
            break

    # Suggested display name from the ZIP filename
    raw_name = zip_name.removesuffix(".zip").replace("_", " ").replace("-", " ")
    suggested_name = " ".join(w.capitalize() for w in raw_name.split()) if raw_name else "My Artifact"

    # ── Build LLM prompt ──────────────────────────────────────────────────────
    file_list = ", ".join(f.name for f in files[:15])
    instructions_field = (
        '"instructions": null'
        if howto_content
        else '"instructions": "<short Markdown guide with ## Installation and ## Usage sections>"'
    )
    prompt = f"""You are analyzing an AI artifact (agent, skill, or MCP server) to generate metadata.

Artifact name hint: "{suggested_name}"
Files included: {file_list}

{"--- skill.md / README content ---\n" + howto_content[:3000] if howto_content else ""}

{"--- Code file previews ---\n" + chr(10).join(code_snippets) if code_snippets else ""}

Return ONLY a JSON object with these exact fields:
- "display_name": clean title-case name (use the name hint as a starting point)
- "description": 1-2 sentences describing what this artifact does and its primary use case
- {instructions_field}

Return ONLY the JSON object, no markdown, no explanation."""

    try:
        raw = await call_llm(prompt)
        # Extract JSON even if the LLM wraps it in markdown code fences
        raw = raw.strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        result = _json.loads(raw.strip())
        display_name = str(result.get("display_name") or suggested_name).strip()
        description = str(result.get("description") or "").strip()
        instructions = howto_content or (result.get("instructions") or None)
    except Exception:
        display_name = suggested_name
        description = ""
        instructions = howto_content

    return ArtifactAnalyzeResponse(
        display_name=display_name,
        description=description,
        instructions=instructions,
    )


@router.post("/artifacts/github-config/test/{artifact_type}")
async def test_github_config(artifact_type: str, admin: dict = Depends(require_admin)):
    if artifact_type not in ("agent", "skill", "mcp"):
        raise HTTPException(400, "artifact_type must be agent, skill, or mcp")
    db = await get_db()
    config = await _load_github_config(db)
    type_config = config.get(artifact_type, {})
    try:
        result = await test_connection(type_config)
    except Exception as exc:
        result = {"ok": False, "checks": [], "error": str(exc)}
    return result


@router.put("/artifacts/github-config")
async def put_github_config(req: ArtifactGithubConfig, admin: dict = Depends(require_admin)):
    db = await get_db()
    existing = await _load_github_config(db)

    config = {}
    for atype in ("agent", "skill", "mcp"):
        incoming: ArtifactGithubTypeConfig = getattr(req, atype)
        old = existing.get(atype, {})
        token = incoming.token
        if not token or token == "••••••••":
            token = old.get("token", "")
        config[atype] = {
            "url": incoming.url,
            "branch": incoming.branch,
            "folder": incoming.folder,
            "token": token,
        }

    await _save_github_config(db, config)
    return _mask_config(config)


# ── Submissions — list ────────────────────────────────────────────────────────

@router.get("/artifacts", response_model=list[ArtifactSubmissionResponse])
async def list_artifacts(
    artifact_type: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    user: dict = Depends(require_content),
):
    db = await get_db()
    is_admin = user["role"] == "admin"

    conditions = ["1=1"]
    params: list = []

    if not is_admin:
        conditions.append(f"s.submitted_by = ${len(params)+1}")
        params.append(user["id"])

    if artifact_type:
        conditions.append(f"s.artifact_type = ${len(params)+1}")
        params.append(artifact_type)

    if status:
        conditions.append(f"s.status = ${len(params)+1}")
        params.append(status)

    where = " AND ".join(conditions)
    rows = await db.fetch(
        f"""
        SELECT s.*, u.display_name AS submitter_name
        FROM artifact_submissions s
        LEFT JOIN users u ON s.submitted_by = u.id
        WHERE {where}
        ORDER BY s.updated_at DESC
        """,
        *params,
    )
    return [_row_to_response(r, r.get("submitter_name")) for r in rows]


# ── Submissions — create ──────────────────────────────────────────────────────

@router.post("/artifacts", response_model=ArtifactSubmissionResponse)
async def create_artifact(req: ArtifactSubmissionCreate, user: dict = Depends(require_content)):
    db = await get_db()
    existing = await db.fetchval(
        "SELECT id FROM artifact_submissions WHERE name = $1 AND artifact_type = $2 AND status != 'rejected'",
        req.name, req.artifact_type,
    )
    if existing:
        raise HTTPException(400, f"An artifact named '{req.name}' of type '{req.artifact_type}' already exists")

    files_json = json.dumps([f.model_dump() for f in req.files])
    row = await db.fetchrow(
        """
        INSERT INTO artifact_submissions
            (name, display_name, artifact_type, description, instructions, files, tags, submitted_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING *
        """,
        req.name, req.display_name, req.artifact_type,
        req.description, req.instructions,
        files_json, req.tags or [],
        user["id"],
    )
    submitter_name = user.get("display_name")
    return _row_to_response(row, submitter_name)


# ── Single submission ─────────────────────────────────────────────────────────

@router.get("/artifacts/{artifact_id}", response_model=ArtifactSubmissionResponse)
async def get_artifact(artifact_id: str, user: dict = Depends(require_content)):
    db = await get_db()
    row = await db.fetchrow(
        """
        SELECT s.*, u.display_name AS submitter_name
        FROM artifact_submissions s
        LEFT JOIN users u ON s.submitted_by = u.id
        WHERE s.id = $1
        """,
        artifact_id,
    )
    if not row:
        raise HTTPException(404, "Artifact not found")
    is_admin = user["role"] == "admin"
    is_owner = str(row["submitted_by"]) == str(user["id"])
    if not is_admin and not is_owner:
        raise HTTPException(403, "Access denied")
    return _row_to_response(row, row.get("submitter_name"))


@router.put("/artifacts/{artifact_id}", response_model=ArtifactSubmissionResponse)
async def update_artifact(
    artifact_id: str, req: ArtifactSubmissionUpdate, user: dict = Depends(require_content)
):
    db = await get_db()
    row = await db.fetchrow("SELECT * FROM artifact_submissions WHERE id = $1", artifact_id)
    if not row:
        raise HTTPException(404, "Artifact not found")

    is_admin = user["role"] == "admin"
    is_owner = str(row["submitted_by"]) == str(user["id"])
    if not is_admin and not is_owner:
        raise HTTPException(403, "Access denied")
    if row["status"] not in ("draft", "rejected") and not is_admin:
        raise HTTPException(400, "Only draft or rejected submissions can be edited")

    updates: dict = {}
    if req.display_name is not None:
        updates["display_name"] = req.display_name
    if req.description is not None:
        updates["description"] = req.description
    if req.instructions is not None:
        updates["instructions"] = req.instructions
    if req.files is not None:
        updates["files"] = json.dumps([f.model_dump() for f in req.files])
    if req.tags is not None:
        updates["tags"] = req.tags

    if updates:
        set_parts = [f"{k} = ${i+1}" for i, k in enumerate(updates.keys())]
        set_parts.append("updated_at = now()")
        set_parts.append("validation_results = NULL")  # invalidate prior results on edit
        vals = list(updates.values()) + [artifact_id]
        await db.execute(
            f"UPDATE artifact_submissions SET {', '.join(set_parts)} WHERE id = ${len(vals)}",
            *vals,
        )

    row = await db.fetchrow(
        """
        SELECT s.*, u.display_name AS submitter_name
        FROM artifact_submissions s LEFT JOIN users u ON s.submitted_by = u.id
        WHERE s.id = $1
        """,
        artifact_id,
    )
    return _row_to_response(row, row.get("submitter_name"))


@router.delete("/artifacts/{artifact_id}")
async def delete_artifact(artifact_id: str, user: dict = Depends(require_content)):
    db = await get_db()
    row = await db.fetchrow("SELECT * FROM artifact_submissions WHERE id = $1", artifact_id)
    if not row:
        raise HTTPException(404, "Artifact not found")

    is_admin = user["role"] == "admin"
    is_owner = str(row["submitted_by"]) == str(user["id"])
    if not is_admin and not is_owner:
        raise HTTPException(403, "Access denied")
    if row["status"] == "published" and not is_admin:
        raise HTTPException(400, "Published artifacts can only be deleted by admins")

    await db.execute("DELETE FROM artifact_submissions WHERE id = $1", artifact_id)
    return {"message": "Deleted"}


# ── Workflow actions ──────────────────────────────────────────────────────────

@router.post("/artifacts/{artifact_id}/validate", response_model=ValidationResult)
async def validate_artifact(artifact_id: str, user: dict = Depends(require_content)):
    db = await get_db()
    row = await db.fetchrow("SELECT * FROM artifact_submissions WHERE id = $1", artifact_id)
    if not row:
        raise HTTPException(404, "Artifact not found")

    is_admin = user["role"] == "admin"
    is_owner = str(row["submitted_by"]) == str(user["id"])
    if not is_admin and not is_owner:
        raise HTTPException(403, "Access denied")

    files_raw = row["files"] if isinstance(row["files"], list) else json.loads(row["files"] or "[]")
    results = validate_files(files_raw)

    await db.execute(
        "UPDATE artifact_submissions SET validation_results = $1, updated_at = now() WHERE id = $2",
        json.dumps(results), artifact_id,
    )

    return ValidationResult(
        passed=results["passed"],
        errors=[ValidationIssue(**e) for e in results["errors"]],
        warnings=[ValidationIssue(**w) for w in results["warnings"]],
    )


@router.post("/artifacts/{artifact_id}/submit")
async def submit_artifact(
    artifact_id: str,
    background_tasks: BackgroundTasks,
    user: dict = Depends(require_content),
):
    """Move artifact from draft/rejected → pending (contributor submits for review)."""
    db = await get_db()
    row = await db.fetchrow("SELECT * FROM artifact_submissions WHERE id = $1", artifact_id)
    if not row:
        raise HTTPException(404, "Artifact not found")

    is_admin = user["role"] == "admin"
    is_owner = str(row["submitted_by"]) == str(user["id"])
    if not is_admin and not is_owner:
        raise HTTPException(403, "Access denied")
    if row["status"] not in ("draft", "rejected"):
        raise HTTPException(400, f"Cannot submit from status '{row['status']}'")

    # Require at least one file
    files_raw = row["files"] if isinstance(row["files"], list) else json.loads(row["files"] or "[]")
    if not files_raw:
        raise HTTPException(400, "Submission must contain at least one file")

    # Auto-run validation on submit
    results = validate_files(files_raw)
    if not results["passed"]:
        raise HTTPException(422, {
            "message": "Submission blocked: secrets or unsafe patterns detected. Run Validate and fix all errors first.",
            "validation": results,
        })

    await db.execute(
        """
        UPDATE artifact_submissions
        SET status = 'pending', validation_results = $1, updated_at = now()
        WHERE id = $2
        """,
        json.dumps(results), artifact_id,
    )

    # Notify reviewers (publish authority + admins) that an item awaits review
    background_tasks.add_task(
        _notify_reviewers, db,
        str(artifact_id), "marketplace", row["display_name"],
        user.get("display_name") or user.get("username"), None, settings.PORTAL_BASE_URL,
    )
    return {"message": "Submitted for review"}


async def _get_submitter_contact(db, submitted_by) -> tuple[str, str]:
    """Return (email, display_name) for the artifact's submitter."""
    if not submitted_by:
        return "", "there"
    u = await db.fetchrow(
        "SELECT email, display_name, username FROM users WHERE id = $1", submitted_by
    )
    if not u:
        return "", "there"
    return (u["email"] or "", u["display_name"] or u["username"] or "there")


async def _notify_marketplace_decision(to_email: str, display_name: str,
                                       item_title: str, item_type: str,
                                       approved: bool, reason: str | None):
    """Email the submitter when their marketplace submission is reviewed."""
    if not to_email or "@" not in to_email:
        return
    status_word = "Approved" if approved else "Rejected"
    status_color = "#22c55e" if approved else "#ef4444"
    intro = (
        "Your marketplace submission has been approved and will be published shortly."
        if approved else
        "Your marketplace submission was not approved. You can address the feedback and resubmit."
    )
    reason_html = (
        f"<p style='color:#94a3b8;font-size:13px;'><b>Reviewer note:</b> {reason}</p>"
        if reason else ""
    )
    action_html = (
        f'<a href="{settings.PORTAL_BASE_URL}/marketplace" style="display:inline-block;'
        f'background:#258cf4;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;'
        f'font-weight:600;font-size:14px;margin-top:8px;">View Marketplace →</a>'
    )
    html = f"""
    <div style="font-family:Inter,sans-serif;background:#0a0f14;padding:32px;border-radius:12px;max-width:600px;margin:auto;">
      <h2 style="color:{status_color};font-size:20px;margin-bottom:4px;">Marketplace Submission {status_word}</h2>
      <p style="color:#64748b;font-size:13px;margin-bottom:24px;">Hi {display_name}, your submission has been reviewed.</p>
      <div style="background:#131a22;border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:16px;margin-bottom:20px;">
        <p style="color:#94a3b8;font-size:12px;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;">{item_type}</p>
        <p style="color:#f1f5f9;font-size:16px;font-weight:600;margin:0 0 8px;">{item_title}</p>
        <p style="color:#94a3b8;font-size:13px;margin:0;">{intro}</p>
      </div>
      {reason_html}
      {action_html}
      <p style="color:#475569;font-size:11px;margin-top:24px;">MST AI Portal · Marketplace</p>
    </div>
    """
    try:
        await send_email_multi(
            subject=f"Marketplace Submission {status_word}: {item_title}",
            html_content=html,
            to_emails=[to_email],
        )
    except Exception as e:
        log.error(f"Failed to send marketplace decision notification: {e}")


@router.post("/artifacts/{artifact_id}/approve")
async def approve_artifact(
    artifact_id: str,
    background_tasks: BackgroundTasks,
    admin: dict = Depends(require_admin),
):
    db = await get_db()
    row = await db.fetchrow("SELECT * FROM artifact_submissions WHERE id = $1", artifact_id)
    if not row:
        raise HTTPException(404, "Artifact not found")
    if row["status"] != "pending":
        raise HTTPException(400, f"Cannot approve from status '{row['status']}'")

    await db.execute(
        """
        UPDATE artifact_submissions
        SET status = 'approved', reviewed_by = $1, updated_at = now()
        WHERE id = $2
        """,
        admin["id"], artifact_id,
    )

    # Notify the submitter that their item was approved
    email, name = await _get_submitter_contact(db, row.get("submitted_by"))
    background_tasks.add_task(
        _notify_marketplace_decision, email, name,
        row["display_name"], row["artifact_type"], True, None,
    )
    return {"message": "Approved"}


@router.post("/artifacts/{artifact_id}/reject")
async def reject_artifact(
    artifact_id: str,
    body: dict,
    background_tasks: BackgroundTasks,
    admin: dict = Depends(require_admin),
):
    reason = (body.get("reason") or "").strip()
    db = await get_db()
    row = await db.fetchrow("SELECT * FROM artifact_submissions WHERE id = $1", artifact_id)
    if not row:
        raise HTTPException(404, "Artifact not found")
    if row["status"] not in ("pending", "approved"):
        raise HTTPException(400, f"Cannot reject from status '{row['status']}'")

    await db.execute(
        """
        UPDATE artifact_submissions
        SET status = 'rejected', reviewed_by = $1, reject_reason = $2, updated_at = now()
        WHERE id = $3
        """,
        admin["id"], reason or None, artifact_id,
    )

    # Notify the submitter that their item was rejected
    email, name = await _get_submitter_contact(db, row.get("submitted_by"))
    background_tasks.add_task(
        _notify_marketplace_decision, email, name,
        row["display_name"], row["artifact_type"], False, reason or None,
    )
    return {"message": "Rejected"}


@router.post("/artifacts/{artifact_id}/publish")
async def publish_artifact(artifact_id: str, admin: dict = Depends(require_admin)):
    """Push an approved artifact to its GitHub backend."""
    db = await get_db()
    row = await db.fetchrow("SELECT * FROM artifact_submissions WHERE id = $1", artifact_id)
    if not row:
        raise HTTPException(404, "Artifact not found")
    if row["status"] != "approved":
        raise HTTPException(400, "Only approved artifacts can be published")

    config = await _load_github_config(db)
    type_config = config.get(row["artifact_type"], {})

    if not type_config.get("url") or not type_config.get("token"):
        raise HTTPException(400, f"GitHub backend not fully configured for type '{row['artifact_type']}'")

    files_raw = row["files"] if isinstance(row["files"], list) else json.loads(row["files"] or "[]")

    try:
        github_url = await push_artifact(type_config, row["name"], files_raw)
    except ValueError as exc:
        raise HTTPException(502, f"GitHub push failed: {exc}")

    await db.execute(
        """
        UPDATE artifact_submissions
        SET status = 'published', github_url = $1, updated_at = now()
        WHERE id = $2
        """,
        github_url, artifact_id,
    )
    return {"message": "Published", "github_url": github_url}
