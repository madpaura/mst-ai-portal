import asyncio
import os
import shutil
import subprocess
import tempfile
import zipfile
from io import BytesIO

from fastapi import APIRouter, HTTPException, Depends, Query
from fastapi.responses import StreamingResponse
from typing import Optional

from forge.schemas import ForgeComponentResponse, ForgeCategoryResponse
from auth.dependencies import get_optional_user
from database import get_db

router = APIRouter()


def _row_to_component(r) -> ForgeComponentResponse:
    return ForgeComponentResponse(
        id=str(r["id"]), slug=r["slug"], name=r["name"],
        component_type=r["component_type"], description=r.get("description"),
        long_description=r.get("long_description"), icon=r.get("icon"),
        icon_color=r.get("icon_color"), version=r["version"],
        install_command=r["install_command"], badge=r.get("badge"),
        author=r.get("author"), downloads=r["downloads"],
        tags=list(r["tags"]) if r["tags"] else [],
        is_active=r["is_active"],
        howto_guide=r.get("howto_guide"),
        git_repo_url=r.get("git_repo_url"),
        git_ref=r.get("git_ref"),
        last_synced_at=r.get("last_synced_at"),
        created_at=r["created_at"],
        updated_at=r["updated_at"],
    )


@router.get("/components", response_model=list[ForgeComponentResponse])
async def list_components(
    type: Optional[str] = Query(None, alias="type"),
    badge: Optional[str] = None,
    q: Optional[str] = None,
):
    db = await get_db()
    conditions = ["is_active = true"]
    params = []
    idx = 1

    if type:
        conditions.append(f"component_type = ${idx}")
        params.append(type)
        idx += 1

    if badge:
        conditions.append(f"badge = ${idx}")
        params.append(badge)
        idx += 1

    if q:
        conditions.append(
            f"to_tsvector('english', name || ' ' || COALESCE(description, '')) @@ plainto_tsquery('english', ${idx})"
        )
        params.append(q)
        idx += 1

    where = " AND ".join(conditions)
    rows = await db.fetch(
        f"SELECT * FROM forge_components WHERE {where} ORDER BY downloads DESC, name ASC",
        *params,
    )
    return [_row_to_component(r) for r in rows]


@router.get("/components/{slug}", response_model=ForgeComponentResponse)
async def get_component(slug: str):
    db = await get_db()
    row = await db.fetchrow(
        "SELECT * FROM forge_components WHERE slug = $1 AND is_active = true", slug
    )
    if not row:
        raise HTTPException(status_code=404, detail="Component not found")
    return _row_to_component(row)


@router.post("/components/{slug}/install")
async def install_component(slug: str, user: Optional[dict] = Depends(get_optional_user)):
    db = await get_db()
    comp = await db.fetchrow(
        "SELECT id FROM forge_components WHERE slug = $1 AND is_active = true", slug
    )
    if not comp:
        raise HTTPException(status_code=404, detail="Component not found")

    user_id = user["id"] if user else None
    await db.execute(
        "INSERT INTO forge_install_events (component_id, user_id) VALUES ($1, $2)",
        comp["id"], user_id,
    )
    await db.execute(
        "UPDATE forge_components SET downloads = downloads + 1 WHERE id = $1",
        comp["id"],
    )
    return {"message": "Install event recorded"}


@router.get("/categories", response_model=list[ForgeCategoryResponse])
async def list_categories():
    db = await get_db()
    rows = await db.fetch(
        "SELECT component_type, COUNT(*) as count FROM forge_components WHERE is_active = true GROUP BY component_type ORDER BY component_type"
    )
    return [ForgeCategoryResponse(component_type=r["component_type"], count=r["count"]) for r in rows]


@router.get("/components/{slug}/download")
async def download_component(slug: str, user: Optional[dict] = Depends(get_optional_user)):
    """Download a component as a zip file by cloning its directory from the git repo."""
    db = await get_db()
    row = await db.fetchrow(
        "SELECT * FROM forge_components WHERE slug = $1 AND is_active = true", slug
    )
    if not row:
        raise HTTPException(status_code=404, detail="Component not found")

    git_url = row.get("git_repo_url")
    if not git_url:
        raise HTTPException(status_code=400, detail="Component has no linked git repository")

    git_ref = row.get("git_ref") or "main"

    # Look up the git token from forge_settings for this repo
    setting = await db.fetchrow(
        "SELECT git_token, git_url, scan_paths FROM forge_settings WHERE git_url = $1 LIMIT 1",
        git_url,
    )
    auth_url = git_url
    scan_paths = ["skills"]
    if setting:
        token = setting.get("git_token")
        scan_paths = list(setting.get("scan_paths") or ["skills"])
        if token:
            if "github.com" in git_url:
                auth_url = git_url.replace("https://", f"https://x-access-token:{token}@")
            elif "gitlab" in git_url:
                auth_url = git_url.replace("https://", f"https://oauth2:{token}@")
            else:
                auth_url = git_url.replace("https://", f"https://{token}@")

    tmpdir = tempfile.mkdtemp(prefix="forge_dl_")
    try:
        # Clone the repo (shallow)
        git_env = {**os.environ, "GIT_TERMINAL_PROMPT": "0", "GIT_SSL_NO_VERIFY": "true"}
        proc = await asyncio.create_subprocess_exec(
            "git", "clone", "--depth", "1", "--branch", git_ref, auth_url, tmpdir,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            env=git_env,
        )
        _, stderr = await asyncio.wait_for(proc.communicate(), timeout=60)
        if proc.returncode != 0:
            raise HTTPException(status_code=500, detail=f"Git clone failed: {stderr.decode()[:200]}")

        # Find the component directory
        comp_dir = None
        for sp in scan_paths:
            candidate = os.path.join(tmpdir, sp.strip(), slug)
            if os.path.isdir(candidate):
                comp_dir = candidate
                break

        if not comp_dir:
            # Try searching by slug anywhere
            for root, dirs, _ in os.walk(tmpdir):
                if slug in dirs:
                    comp_dir = os.path.join(root, slug)
                    break

        if not comp_dir or not os.path.isdir(comp_dir):
            raise HTTPException(status_code=404, detail=f"Component directory '{slug}' not found in repository")

        # Create zip in memory
        buf = BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            for root, dirs, files in os.walk(comp_dir):
                # Skip hidden dirs
                dirs[:] = [d for d in dirs if not d.startswith(".")]
                for f in files:
                    if f.startswith("."):
                        continue
                    fpath = os.path.join(root, f)
                    arcname = os.path.join(slug, os.path.relpath(fpath, comp_dir))
                    zf.write(fpath, arcname)

        buf.seek(0)

        # Record download
        user_id = user["id"] if user else None
        await db.execute(
            "INSERT INTO forge_install_events (component_id, user_id) VALUES ($1, $2)",
            row["id"], user_id,
        )
        await db.execute(
            "UPDATE forge_components SET downloads = downloads + 1 WHERE id = $1",
            row["id"],
        )

        return StreamingResponse(
            buf,
            media_type="application/zip",
            headers={"Content-Disposition": f'attachment; filename="{slug}.zip"'},
        )
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


@router.get("/components/{slug}/instructions")
async def get_install_instructions(slug: str):
    """Return install/usage instructions for a component."""
    db = await get_db()
    row = await db.fetchrow(
        "SELECT slug, name, component_type, long_description, howto_guide, install_command FROM forge_components WHERE slug = $1 AND is_active = true",
        slug,
    )
    if not row:
        raise HTTPException(status_code=404, detail="Component not found")

    comp_type = row["component_type"]
    long_desc = row.get("long_description") or ""
    howto = row.get("howto_guide") or ""

    # Try to extract install instructions from long_description
    instructions = ""
    if long_desc:
        # Look for install/setup/usage sections in the markdown
        import re
        sections = re.split(r'^#{1,3}\s+', long_desc, flags=re.MULTILINE)
        for section in sections:
            lower = section.lower()
            if any(kw in lower[:60] for kw in ["install", "setup", "getting started", "usage", "quick start", "how to"]):
                instructions += section.strip() + "\n\n"

    if not instructions and howto:
        instructions = howto

    if not instructions:
        # Generate basic instructions based on type
        if comp_type == "skill":
            instructions = f"""## {row['name']}

### Install

1. Click **Download** to get the zip file
2. Extract into your project's skills folder:
   ```bash
   unzip {slug}.zip -d .roo/skills/
   ```
3. The skill is now available — your AI assistant will pick it up automatically.
"""
        elif comp_type == "mcp_server":
            instructions = f"""## {row['name']}

### Download & Install

1. Download the MCP server using the download button above
2. Extract the zip file:
   ```
   unzip {slug}.zip
   cd {slug}
   ```
3. Install dependencies:
   ```
   npm install    # for Node.js servers
   pip install -r requirements.txt  # for Python servers
   ```
4. Add to your MCP configuration:
   ```json
   {{
     "mcpServers": {{
       "{slug}": {{
         "command": "node",
         "args": ["index.js"]
       }}
     }}
   }}
   ```

### Usage

The MCP server exposes tools that your AI assistant can use automatically once configured.
"""
        else:
            instructions = f"Download and extract {slug}.zip, then follow the README inside."

    return {"slug": slug, "name": row["name"], "component_type": comp_type, "instructions": instructions}
