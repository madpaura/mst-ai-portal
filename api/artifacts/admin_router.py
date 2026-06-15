import json
import re
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
    ArtifactAllowedTypes,
    ArtifactVersionResponse,
    ArtifactVersionInfo,
)
from artifacts.validator import validate_files
from artifacts.github_client import push_artifact, test_connection, delete_artifact as gh_delete_artifact
from howto_guides import generate_howto_guide, build_about_prompt, clamp_words, about_source_hash
from auth.dependencies import require_admin, require_content, get_current_user
from database import get_db
from publish.router import _notify_reviewers
from email_utils.utils import send_email_multi
from config import settings
from loguru import logger as log

router = APIRouter()

_SETTINGS_KEY = "artifact_github_config"
_ALLOWED_TYPES_KEY = "artifact_allowed_types"
_ALL_TYPES = ["agent", "skill", "mcp"]


# ── Install-instruction helpers (Issue #167) ──────────────────────────────────

def _extract_owner_repo_url(git_url: str) -> Optional[str]:
    """Return 'owner/repo' from a GitHub/GitLab remote URL, or None."""
    if not git_url:
        return None
    m = re.search(r'(?:github|gitlab)\.com[:/]([^/]+/[^/.]+?)(?:\.git)?/?$', git_url)
    if m:
        return m.group(1)
    parts = git_url.rstrip('/').removesuffix('.git').rsplit('/', 2)
    if len(parts) >= 2 and parts[-2] and parts[-1]:
        return f"{parts[-2]}/{parts[-1]}"
    return None


def _generate_skill_instructions(
    display_name: str, slug: str, owner_repo: str, artifact_type: str = "skill",
) -> str:
    """Type-aware install how-to guide for an artifact (delegates to the shared module)."""
    return generate_howto_guide(slug, display_name, artifact_type, owner_repo)


async def _make_about(name: str, artifact_type: str, source_text: str) -> Optional[str]:
    """LLM-polished, ≤200-word About text. Falls back to trimmed source on any failure."""
    source = (source_text or "").strip()
    if not source:
        return None
    try:
        from articles.llm import call_llm
        raw = await call_llm(build_about_prompt(name, artifact_type, source))
        about = clamp_words(raw)
        if about:
            return about
    except Exception as e:  # LLM unavailable / misconfigured — degrade gracefully
        log.warning("About LLM generation failed for {}: {}", name, e)
    return clamp_words(source)


# ─────────────────────────────────────────────────────────────────────────────

# ── Helpers ───────────────────────────────────────────────────────────────────

def _results_to_schema(vd: dict) -> ValidationResult:
    """Map a stored/fresh validation-result dict into the response schema.

    Tolerates legacy rows (pre-SkillSpector) where only passed/errors/warnings
    were stored — the SkillSpector summary fields default to None.
    """
    return ValidationResult(
        passed=vd.get("passed", False),
        errors=[ValidationIssue(**e) for e in vd.get("errors", [])],
        warnings=[ValidationIssue(**w) for w in vd.get("warnings", [])],
        scanner=vd.get("scanner", "skillspector"),
        score=vd.get("score"),
        risk_severity=vd.get("risk_severity"),
        recommendation=vd.get("recommendation"),
        scanned=vd.get("scanned", True),
        used_llm=vd.get("used_llm"),
        note=vd.get("note"),
    )


def _row_to_response(row, submitter_name: Optional[str] = None) -> ArtifactSubmissionResponse:
    files_raw = row["files"] if isinstance(row["files"], list) else json.loads(row["files"] or "[]")
    files = [ArtifactFile(name=f["name"], content=f["content"]) for f in files_raw]

    val_raw = row["validation_results"]
    validation_results = None
    if val_raw:
        vd = val_raw if isinstance(val_raw, dict) else json.loads(val_raw)
        validation_results = _results_to_schema(vd)

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
        parent_slug=row.get("parent_slug"),
        version_tag=row.get("version_tag"),
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


def _bump_version(current: Optional[str], level: str) -> str:
    parts = (current or "0.0.0").lstrip("vV").split(".")
    try:
        major, minor, patch = int(parts[0]), int(parts[1]), int(parts[2])
    except (IndexError, ValueError):
        major, minor, patch = 0, 0, 0
    if level == "major":
        return f"{major + 1}.0.0"
    if level == "minor":
        return f"{major}.{minor + 1}.0"
    return f"{major}.{minor}.{patch + 1}"


async def _latest_version(db, name: str, artifact_type: str) -> Optional[str]:
    return await db.fetchval(
        """
        SELECT version FROM artifact_versions
        WHERE name = $1 AND artifact_type = $2
        ORDER BY published_at DESC LIMIT 1
        """,
        name, artifact_type,
    )


def _mask_config(config: dict) -> dict:
    masked = {}
    for atype, cfg in config.items():
        masked[atype] = {**cfg, "token": "••••••••" if cfg.get("token") else ""}
    return masked


async def _load_allowed_types(db) -> list:
    row = await db.fetchrow("SELECT value FROM app_settings WHERE key = $1", _ALLOWED_TYPES_KEY)
    if not row:
        return list(_ALL_TYPES)
    try:
        allowed = json.loads(row["value"]).get("allowed", _ALL_TYPES)
    except (json.JSONDecodeError, AttributeError):
        return list(_ALL_TYPES)
    cleaned = [t for t in _ALL_TYPES if t in allowed]
    return cleaned or list(_ALL_TYPES)


async def _save_allowed_types(db, allowed: list):
    await db.execute(
        """
        INSERT INTO app_settings (key, value)
        VALUES ($1, $2)
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
        """,
        _ALLOWED_TYPES_KEY,
        json.dumps({"allowed": allowed}),
    )


# ── GitHub Config (admin only) ────────────────────────────────────────────────

@router.get("/artifacts/github-config")
async def get_github_config(admin: dict = Depends(require_admin)):
    db = await get_db()
    config = await _load_github_config(db)
    return _mask_config(config)


@router.get("/artifacts/allowed-types", response_model=ArtifactAllowedTypes)
async def get_allowed_types(user: dict = Depends(require_content)):
    """Which artifact types contributors are allowed to submit. Used by the New form."""
    db = await get_db()
    return ArtifactAllowedTypes(allowed=await _load_allowed_types(db))


@router.put("/artifacts/allowed-types", response_model=ArtifactAllowedTypes)
async def put_allowed_types(req: ArtifactAllowedTypes, admin: dict = Depends(require_admin)):
    db = await get_db()
    await _save_allowed_types(db, req.allowed)
    return ArtifactAllowedTypes(allowed=req.allowed)


@router.get("/artifacts/version-info", response_model=ArtifactVersionInfo)
async def get_version_info(
    name: str = Query(...),
    artifact_type: str = Query(...),
    user: dict = Depends(require_content),
):
    """Latest published version for a lineage — lets the update form preview the next bump."""
    db = await get_db()
    current = await _latest_version(db, name, artifact_type)
    if current is None:
        # Fall back to the marketplace component's version if it was published before history existed.
        current = await db.fetchval(
            "SELECT version FROM forge_components WHERE slug = $1", name
        )
    return ArtifactVersionInfo(current=current)


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

    # Suggested display name and slug from the ZIP filename
    raw_name = zip_name.removesuffix(".zip").replace("_", " ").replace("-", " ")
    suggested_name = " ".join(w.capitalize() for w in raw_name.split()) if raw_name else "My Artifact"
    suggested_slug = re.sub(r'[^a-z0-9]+', '-', raw_name.lower()).strip('-') or "my-artifact"

    # ── Look up the configured skill repo to build the exact install command ──
    db = await get_db()
    github_config = await _load_github_config(db)
    skill_repo_url = github_config.get("skill", {}).get("url", "")
    owner_repo = _extract_owner_repo_url(skill_repo_url) or "madpaura/skills"
    install_cmd_example = f"npx skills add {owner_repo} --skill {suggested_slug} --agent claude-code --global --yes"

    # ── Build LLM prompt ──────────────────────────────────────────────────────
    file_list = ", ".join(f.name for f in files[:15])
    if howto_content:
        instructions_field = '"instructions": null'
    else:
        instructions_field = (
            f'"instructions": "<Markdown how-to guide. Start with a ## Installation section '
            f'that contains the exact command: `{install_cmd_example}` (replace {suggested_slug} '
            f'with the actual slug if different). Then add ## Usage and ## Update sections.>"'
        )
    # Pre-build context blocks to avoid backslashes inside f-string expressions (Python 3.11)
    readme_block = ("--- skill.md / README content ---\n" + howto_content[:3000]) if howto_content else ""
    code_block = ("--- Code file previews ---\n" + "\n".join(code_snippets)) if code_snippets else ""
    prompt = (
        f'You are analyzing an AI artifact (agent, skill, or MCP server) to generate metadata.\n\n'
        f'Artifact name hint: "{suggested_name}"\n'
        f'Files included: {file_list}\n\n'
        f'{readme_block}\n\n'
        f'{code_block}\n\n'
        f'Return ONLY a JSON object with these exact fields:\n'
        f'- "display_name": clean title-case name (use the name hint as a starting point)\n'
        f'- "description": 1-2 sentences describing what this artifact does and its primary use case\n'
        f'- {instructions_field}\n\n'
        f'Return ONLY the JSON object, no markdown, no explanation.'
    )

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

    # If instructions are still empty (LLM failed or returned null with no howto file),
    # fall back to the generated template so the field is never left blank.
    if not instructions:
        instructions = _generate_skill_instructions(display_name, suggested_slug, owner_repo)

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

    is_update = bool(req.parent_slug)
    is_admin = user["role"] == "admin"

    if is_update:
        parent = await db.fetchval(
            "SELECT id FROM forge_components WHERE slug = $1",
            req.parent_slug,
        )
        if not parent:
            raise HTTPException(400, f"No published component found with slug '{req.parent_slug}'")
    else:
        allowed = await _load_allowed_types(db)
        if req.artifact_type not in allowed:
            raise HTTPException(
                400,
                f"Artifact type '{req.artifact_type}' is not currently accepted. "
                f"Allowed types: {', '.join(allowed)}",
            )
        existing = await db.fetchval(
            "SELECT id FROM artifact_submissions WHERE name = $1 AND artifact_type = $2 AND status != 'rejected'",
            req.name, req.artifact_type,
        )
        if existing:
            raise HTTPException(400, f"An artifact named '{req.name}' of type '{req.artifact_type}' already exists")

    # Admins submitting updates skip the approval queue — start at 'approved'
    initial_status = "approved" if (is_admin and is_update) else "draft"

    # Auto-generate instructions if the creator didn't provide them (Issue #167)
    instructions = req.instructions
    if not instructions:
        github_config = await _load_github_config(db)
        type_repo_url = github_config.get(req.artifact_type, {}).get("url", "")
        owner_repo = _extract_owner_repo_url(type_repo_url) or "madpaura/skills"
        instructions = _generate_skill_instructions(
            req.display_name, req.name, owner_repo, req.artifact_type
        )

    files_json = json.dumps([f.model_dump() for f in req.files])
    row = await db.fetchrow(
        """
        INSERT INTO artifact_submissions
            (name, display_name, artifact_type, description, instructions, files, tags,
             submitted_by, parent_slug, version_tag, version_bump, status)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        RETURNING *
        """,
        req.name, req.display_name, req.artifact_type,
        req.description, instructions,
        files_json, req.tags or [],
        user["id"],
        req.parent_slug, req.version_tag,
        (req.version_bump or "patch") if is_update else req.version_bump,
        initial_status,
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


@router.get("/artifacts/{artifact_id}/versions", response_model=list[ArtifactVersionResponse])
async def list_artifact_versions(artifact_id: str, user: dict = Depends(require_content)):
    """Read-only published-version history for an artifact's lineage (name + type)."""
    db = await get_db()
    row = await db.fetchrow(
        "SELECT name, artifact_type, submitted_by FROM artifact_submissions WHERE id = $1",
        artifact_id,
    )
    if not row:
        raise HTTPException(404, "Artifact not found")
    is_admin = user["role"] == "admin"
    is_owner = str(row["submitted_by"]) == str(user["id"])
    if not is_admin and not is_owner:
        raise HTTPException(403, "Access denied")

    versions = await db.fetch(
        """
        SELECT v.*, u.display_name AS publisher_name
        FROM artifact_versions v
        LEFT JOIN users u ON v.published_by = u.id
        WHERE v.name = $1 AND v.artifact_type = $2
        ORDER BY v.published_at DESC
        """,
        row["name"], row["artifact_type"],
    )
    out = []
    for v in versions:
        files_raw = v["files"] if isinstance(v["files"], list) else json.loads(v["files"] or "[]")
        out.append(ArtifactVersionResponse(
            id=str(v["id"]),
            name=v["name"],
            artifact_type=v["artifact_type"],
            version=v["version"],
            description=v["description"],
            instructions=v["instructions"],
            files=files_raw,
            tags=list(v["tags"] or []),
            github_url=v["github_url"],
            published_by_name=v.get("publisher_name"),
            published_at=v["published_at"],
        ))
    return out


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
    if req.version_tag is not None:
        updates["version_tag"] = req.version_tag

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
async def delete_artifact(
    artifact_id: str,
    force: bool = Query(False, description="Delete the portal record even if GitHub cleanup fails"),
    user: dict = Depends(require_content),
):
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

    github_cleaned = False
    # If this was ever pushed, remove it from GitHub (folder + MANIFEST.json + README.md).
    if row["status"] == "published" or row.get("github_url"):
        config = await _load_github_config(db)
        type_config = config.get(row["artifact_type"], {})
        if type_config.get("url") and type_config.get("token"):
            try:
                await gh_delete_artifact(type_config, row["artifact_type"], row["name"])
                github_cleaned = True
            except ValueError as exc:
                if not force:
                    raise HTTPException(
                        502,
                        f"GitHub cleanup failed: {exc}. Re-try, or pass force=true to delete "
                        "the portal record only.",
                    )

    # Deactivate the linked marketplace card so it stops showing in the marketplace.
    slug = row.get("parent_slug") or row["name"]
    await db.execute("UPDATE forge_components SET is_active = false, updated_at = now() WHERE slug = $1", slug)
    try:
        import cache as _cache
        await _cache.bump_version(_cache.NS_FORGE)
    except Exception:  # cache is best-effort
        pass

    await db.execute("DELETE FROM artifact_submissions WHERE id = $1", artifact_id)
    return {"message": "Deleted", "github_cleaned": github_cleaned}


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
    results = await validate_files(files_raw, row["artifact_type"])

    await db.execute(
        "UPDATE artifact_submissions SET validation_results = $1, updated_at = now() WHERE id = $2",
        json.dumps(results), artifact_id,
    )

    return _results_to_schema(results)


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
    results = await validate_files(files_raw, row["artifact_type"])
    if not results["passed"]:
        raise HTTPException(422, {
            "message": "Submission blocked: SkillSpector flagged this artifact as CRITICAL risk. Review the report and address the findings first.",
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

    # Resolve the semantic version: first publish → 1.0.0, otherwise auto-bump the
    # latest published version by the requested level (defaults to patch).
    current = await _latest_version(db, row["name"], row["artifact_type"])
    if current is None and row.get("parent_slug"):
        current = await db.fetchval(
            "SELECT version FROM forge_components WHERE slug = $1", row["parent_slug"]
        )
    if current is None:
        version = "1.0.0"
    else:
        version = _bump_version(current, row.get("version_bump") or "patch")

    author = await db.fetchval("SELECT display_name FROM users WHERE id = $1", row.get("submitted_by"))

    try:
        github_url = await push_artifact(
            type_config, row["name"], files_raw,
            version=version,
            description=row.get("description"),
            tags=list(row.get("tags") or []),
            author=author,
            artifact_type=row["artifact_type"],
        )
    except ValueError as exc:
        raise HTTPException(502, f"GitHub push failed: {exc}")

    await db.execute(
        """
        UPDATE artifact_submissions
        SET status = 'published', github_url = $1, version_tag = $2, updated_at = now()
        WHERE id = $3
        """,
        github_url, version, artifact_id,
    )

    # Snapshot this published version into the read-only history.
    await db.execute(
        """
        INSERT INTO artifact_versions
            (submission_id, name, artifact_type, version, description, instructions,
             files, tags, github_url, published_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        """,
        artifact_id, row["name"], row["artifact_type"], version,
        row.get("description"), row.get("instructions"),
        json.dumps(files_raw), list(row.get("tags") or []),
        github_url, row.get("submitted_by"),
    )

    # When this is an update to an existing marketplace component, reflect the
    # changes immediately (version, description, howto_guide, About).
    parent_slug = row.get("parent_slug")
    if parent_slug:
        # Refresh the About section (long_description) with an LLM-polished,
        # ≤200-word blurb drawn from the artifact's instructions/description.
        about_source = row.get("instructions") or row.get("description") or ""
        about = await _make_about(row["display_name"], row["artifact_type"], about_source)
        about_hash = about_source_hash(about_source) if about_source else None

        await db.execute(
            """
            UPDATE forge_components SET
                version     = COALESCE($1, version),
                description = COALESCE($2, description),
                howto_guide = COALESCE($3, howto_guide),
                long_description = COALESCE($4, long_description),
                source_hash = COALESCE($5, source_hash),
                creator_user_id = COALESCE(creator_user_id, $6),
                updated_at  = now()
            WHERE slug = $7
            """,
            version,
            row.get("description"),
            row.get("instructions"),
            about,
            about_hash,
            row.get("submitted_by"),
            parent_slug,
        )
        import cache as _cache
        await _cache.bump_version(_cache.NS_FORGE)

    return {"message": "Published", "github_url": github_url}
