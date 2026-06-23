"""
Background sync worker for marketplace components (Issues #2, #3, #4).

Scans configured git repositories for skills, MCP servers, and agents.
Reads README.md and other docs, optionally runs through LLM to generate
card details. Picks version from release tags. Also extracts how-to guides.
"""

import os
import re
import json
import shutil
import tempfile
import subprocess
import asyncio
from datetime import datetime
from typing import Optional

import asyncpg
from loguru import logger as log

from howto_guides import generate_howto_guide, build_about_prompt, clamp_words, about_source_hash


# ── Install-command & howto helpers ──────────────────────────────────────────

def _extract_owner_repo(git_url: str) -> Optional[str]:
    """Return 'owner/repo' from a GitHub/GitLab URL, or None if unparseable."""
    if not git_url:
        return None
    m = re.search(r'(?:github|gitlab)\.com[:/]([^/]+/[^/.]+?)(?:\.git)?/?$', git_url)
    if m:
        return m.group(1)
    parts = git_url.rstrip('/').removesuffix('.git').rsplit('/', 2)
    if len(parts) >= 2 and parts[-2] and parts[-1]:
        return f"{parts[-2]}/{parts[-1]}"
    return None


def _clean_repo_url(git_url: str) -> Optional[str]:
    """Return a clean, browsable HTTPS repo URL (no credentials, no trailing .git)."""
    if not git_url:
        return None
    url = git_url.strip()
    # Normalise SSH form: git@host:owner/repo(.git) → https://host/owner/repo
    m = re.match(r'git@([^:]+):(.+)', url)
    if m:
        url = f"https://{m.group(1)}/{m.group(2)}"
    # Strip any embedded credentials (https://user:token@host/…)
    url = re.sub(r'^(https?://)[^@/]+@', r'\1', url)
    url = url.rstrip('/')
    if url.endswith('.git'):
        url = url[:-4]
    return url or None


def _generate_install_command(slug: str, git_repo_url: str, component_type: str = "skill") -> str:
    """Return the canonical `npx skills add` install command using the full repo URL."""
    repo_ref = _clean_repo_url(git_repo_url) or "<repo-url>"
    return f"npx skills add {repo_ref} --skill {slug} --agent claude-code --global --yes"


def _is_placeholder_install_command(cmd: Optional[str]) -> bool:
    """True if the stored command is the old auto-generated placeholder."""
    return not cmd or cmd.strip().startswith("forge install ")


# Type-aware how-to guides now live in `howto_guides.generate_howto_guide`.


# ─────────────────────────────────────────────────────────────────────────────

async def _make_about(name: str, component_type: str, source_text: str) -> str:
    """LLM-polished, word-capped About text. Falls back to trimmed source on any failure."""
    source = (source_text or "").strip()
    if not source:
        return ""
    try:
        # call_llm uses the app's global DB pool for settings; the sync worker runs
        # in-process, so the pool is available.
        from articles.llm import call_llm
        raw = await call_llm(build_about_prompt(name, component_type, source))
        about = clamp_words(raw)
        if about:
            return about
    except Exception as e:  # LLM unavailable / misconfigured — degrade gracefully
        log.warning(f"About LLM generation failed for {name}: {e}")
    return clamp_words(source)


async def _append_log(pool, job_id: int, message: str):
    """Append a timestamped line to the sync job log."""
    ts = datetime.utcnow().strftime("%H:%M:%S")
    line = f"[{ts}] {message}\n"
    await pool.execute(
        "UPDATE forge_sync_jobs SET log = COALESCE(log, '') || $1 WHERE id = $2",
        line, job_id,
    )


async def run_sync_job(job_id: int, db_url: str):
    """Execute a single sync job in the background."""
    pool = await asyncpg.create_pool(db_url, min_size=1, max_size=3)
    try:
        job = await pool.fetchrow("SELECT * FROM forge_sync_jobs WHERE id = $1", job_id)
        if not job:
            return

        settings = await pool.fetchrow(
            "SELECT * FROM forge_settings WHERE id = $1", job["settings_id"]
        )
        if not settings:
            await pool.execute(
                "UPDATE forge_sync_jobs SET status='failed', error='Settings not found', completed_at=now() WHERE id=$1",
                job_id,
            )
            return

        await pool.execute(
            "UPDATE forge_sync_jobs SET status='running', started_at=now(), log='' WHERE id=$1",
            job_id,
        )
        await _append_log(pool, job_id, "Sync job started")

        git_url = settings["git_url"]
        git_token = settings.get("git_token")
        git_branch = settings["git_branch"] or "main"
        scan_paths = list(settings["scan_paths"]) if settings["scan_paths"] else ["."]

        # Clone the repo into a temp dir
        tmpdir = tempfile.mkdtemp(prefix="forge_sync_")
        try:
            clone_url = git_url
            if git_token and "github.com" in git_url:
                clone_url = git_url.replace("https://", f"https://{git_token}@")
            elif git_token and "gitlab" in git_url:
                clone_url = git_url.replace("https://", f"https://oauth2:{git_token}@")

            await _append_log(pool, job_id, f"Cloning {git_url} (branch: {git_branch})...")
            clone_cmd = [
                "git", "clone", "--depth", "1", "--branch", git_branch,
                clone_url, tmpdir,
            ]
            result = subprocess.run(
                clone_cmd, capture_output=True, text=True, timeout=120,
                env={**os.environ, "GIT_TERMINAL_PROMPT": "0", "GIT_SSL_NO_VERIFY": "true"},
            )
            if result.returncode != 0:
                await _append_log(pool, job_id, f"ERROR: Git clone failed: {result.stderr[:300]}")
                await pool.execute(
                    "UPDATE forge_sync_jobs SET status='failed', error=$1, completed_at=now() WHERE id=$2",
                    f"Git clone failed: {result.stderr[:500]}", job_id,
                )
                return

            await _append_log(pool, job_id, "Repository cloned successfully")

            # Get latest release tag
            latest_tag = _get_latest_tag(tmpdir)
            if latest_tag:
                await _append_log(pool, job_id, f"Latest release tag: {latest_tag}")

            # Scan for components
            components_found = 0
            components_created = 0
            components_updated = 0

            await _append_log(pool, job_id, f"Scanning paths: {', '.join(scan_paths)}")

            for scan_path in scan_paths:
                full_scan = os.path.join(tmpdir, scan_path.strip())
                if not os.path.isdir(full_scan):
                    await _append_log(pool, job_id, f"WARNING: Scan path '{scan_path}' not found, skipping")
                    continue

                found = _discover_components(full_scan, tmpdir)
                await _append_log(pool, job_id, f"Found {len(found)} component(s) in '{scan_path}'")
                for comp in found:
                    components_found += 1
                    comp["git_repo_url"] = git_url
                    comp["git_ref"] = latest_tag or git_branch

                    # Canonical install one-liner (Issue #167).
                    install_cmd = _generate_install_command(
                        comp["slug"], git_url, comp["component_type"]
                    )
                    # How-to guide: a type-aware install guide tailored to this artifact
                    # (skill = npx skills, agent = ~/.claude/agents, mcp = claude mcp add).
                    owner_repo = _extract_owner_repo(git_url)
                    howto = generate_howto_guide(
                        comp["slug"], comp["name"], comp["component_type"],
                        owner_repo, repo_url=git_url,
                    )

                    # About text: LLM-polished (≤200 words), regenerated only when the
                    # source README changed since the last sync.
                    raw_source = comp.get("long_description") or comp.get("description") or ""
                    new_hash = about_source_hash(raw_source)

                    existing = await pool.fetchrow(
                        "SELECT id, source_hash, long_description FROM forge_components WHERE slug = $1",
                        comp["slug"],
                    )

                    if existing:
                        unchanged = (
                            existing["source_hash"] == new_hash
                            and (existing["long_description"] or "").strip()
                        )
                        about = existing["long_description"] if unchanged else \
                            await _make_about(comp["name"], comp["component_type"], raw_source)
                        await pool.execute(
                            """UPDATE forge_components SET
                                name=$1, description=$2, long_description=$3, source_hash=$4,
                                version=$5, git_repo_url=$6, git_ref=$7, last_synced_at=now(),
                                howto_guide=$8,
                                install_command = CASE
                                    WHEN install_command IS NULL OR install_command = ''
                                         OR install_command LIKE 'forge install %'
                                         OR install_command LIKE 'npx skills add %' THEN $9
                                    ELSE install_command
                                END,
                                updated_at=now()
                            WHERE slug=$10""",
                            comp["name"], comp["description"], about, new_hash,
                            comp.get("version", latest_tag or "v0.0.0"),
                            git_url, comp["git_ref"], howto, install_cmd,
                            comp["slug"],
                        )
                        components_updated += 1
                        await _append_log(pool, job_id, f"  Updated: {comp['name']} ({comp['slug']})")
                    else:
                        about = await _make_about(comp["name"], comp["component_type"], raw_source)
                        await pool.execute(
                            """INSERT INTO forge_components
                                (slug, name, component_type, description, long_description, source_hash,
                                 icon, icon_color, version, install_command, author, tags,
                                 git_repo_url, git_ref, last_synced_at, howto_guide)
                            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,now(),$15)""",
                            comp["slug"], comp["name"], comp["component_type"],
                            comp["description"], about, new_hash,
                            comp.get("icon", "smart_toy"), comp.get("icon_color", "text-primary"),
                            comp.get("version", latest_tag or "v0.0.0"),
                            install_cmd,
                            comp.get("author", "Auto-discovered"),
                            comp.get("tags", []),
                            git_url, comp["git_ref"], howto,
                        )
                        components_created += 1
                        await _append_log(pool, job_id, f"  Created: {comp['name']} ({comp['slug']})")

            await _append_log(pool, job_id, f"Sync complete: {components_found} found, {components_created} created, {components_updated} updated")
            await pool.execute(
                """UPDATE forge_sync_jobs SET
                    status='completed', completed_at=now(),
                    components_found=$1, components_created=$2, components_updated=$3
                WHERE id=$4""",
                components_found, components_created, components_updated, job_id,
            )

        finally:
            shutil.rmtree(tmpdir, ignore_errors=True)

    except Exception as e:
        log.error(f"Sync job {job_id} error: {e}")
        try:
            await _append_log(pool, job_id, f"FATAL ERROR: {str(e)[:400]}")
            await pool.execute(
                "UPDATE forge_sync_jobs SET status='failed', error=$1, completed_at=now() WHERE id=$2",
                str(e)[:500], job_id,
            )
        except Exception:
            pass
    finally:
        await pool.close()


def _get_latest_tag(repo_dir: str) -> Optional[str]:
    """Get the latest git tag from the repo."""
    try:
        result = subprocess.run(
            ["git", "describe", "--tags", "--abbrev=0"],
            cwd=repo_dir, capture_output=True, text=True, timeout=10,
        )
        if result.returncode == 0:
            return result.stdout.strip()
    except Exception:
        pass

    try:
        result = subprocess.run(
            ["git", "tag", "--sort=-creatordate"],
            cwd=repo_dir, capture_output=True, text=True, timeout=10,
        )
        if result.returncode == 0 and result.stdout.strip():
            return result.stdout.strip().split("\n")[0]
    except Exception:
        pass

    return None


def _discover_components(scan_dir: str, repo_root: str) -> list[dict]:
    """
    Discover components in a directory by scanning for:
    - Directories with README.md or package.json/pyproject.toml
    - Each discovered directory is treated as a potential component
    """
    components = []

    for entry in os.listdir(scan_dir):
        entry_path = os.path.join(scan_dir, entry)
        if not os.path.isdir(entry_path):
            continue
        if entry.startswith(".") or entry in ("node_modules", "__pycache__", ".git", "venv"):
            continue

        readme_path = _find_readme(entry_path)
        if not readme_path:
            continue

        readme_content = ""
        try:
            with open(readme_path, "r", encoding="utf-8", errors="ignore") as f:
                readme_content = f.read(10000)
        except Exception:
            continue

        comp = _parse_component_from_readme(entry, readme_content, entry_path)
        if comp:
            # Extract how-to guide (Issue #4)
            howto = _extract_howto(entry_path, readme_content)
            if howto:
                comp["howto_guide"] = howto
            components.append(comp)

    return components


def _find_readme(directory: str) -> Optional[str]:
    """Find README file in a directory."""
    for name in ["README.md", "readme.md", "README.MD", "README.rst", "README.txt", "README",
                  "SKILL.md", "skill.md", "AGENT.md", "agent.md"]:
        path = os.path.join(directory, name)
        if os.path.isfile(path):
            return path
    return None


def _parse_frontmatter(fm_text: str) -> dict:
    """
    Minimal YAML frontmatter parser that also handles block scalars
    (`key: >` folded and `key: |` literal) and indented continuation lines.

    The previous line-by-line `key: value` regex captured a folded
    `description: >` as just ">", losing the actual multi-line text.
    """
    fm: dict = {}
    lines = fm_text.split("\n")
    i = 0
    while i < len(lines):
        m = re.match(r'^([A-Za-z_][\w-]*)\s*:\s*(.*)$', lines[i])
        if not m:
            i += 1
            continue
        key = m.group(1).strip()
        val = m.group(2).strip()

        # Block scalar (`>`, `|`, with optional chomping +/-) or an empty value
        # followed by indented lines → gather the continuation block.
        if val in ("", ">", "|", ">-", "|-", ">+", "|+"):
            block: list[str] = []
            j = i + 1
            while j < len(lines):
                nxt = lines[j]
                if nxt.strip() == "":
                    block.append("")
                    j += 1
                    continue
                if len(nxt) - len(nxt.lstrip()) == 0:  # next top-level key
                    break
                block.append(nxt.strip())
                j += 1
            text = " ".join(s for s in block if s).strip()  # fold to a single line
            if text or val == "":
                fm[key] = text
            i = j
        else:
            fm[key] = val.strip('"').strip("'")
            i += 1
    return fm


def _parse_component_from_readme(dirname: str, readme: str, dirpath: str) -> Optional[dict]:
    """Parse component metadata from a README or SKILL.md file."""
    # Parse YAML frontmatter if present (---\n...\n---)
    frontmatter: dict = {}
    body = readme
    fm_match = re.match(r'^---\s*\n(.*?)\n---\s*\n?(.*)', readme, re.DOTALL)
    if fm_match:
        fm_text = fm_match.group(1)
        body = fm_match.group(2)
        frontmatter = _parse_frontmatter(fm_text)

    # Try to determine component type from directory name or content
    component_type = "skill"
    dirname_lower = dirname.lower()
    readme_lower = readme.lower()

    if "agent" in dirname_lower or "agent" in readme_lower[:200]:
        component_type = "agent"
    elif "mcp" in dirname_lower or "mcp" in readme_lower[:200] or "model context protocol" in readme_lower[:500]:
        component_type = "mcp_server"
    elif "skill" in dirname_lower or "skill" in readme_lower[:200]:
        component_type = "skill"

    # Extract name: prefer frontmatter > H1 > dirname
    name = frontmatter.get("name")
    if name:
        name = name.replace("-", " ").replace("_", " ").title()
    else:
        title_match = re.search(r'^#\s+(.+)$', body, re.MULTILINE)
        name = title_match.group(1).strip() if title_match else dirname.replace("-", " ").replace("_", " ").title()

    # Extract description: prefer frontmatter > first paragraph
    description = frontmatter.get("description", "")
    if description:
        description = description[:300]
    else:
        paragraphs = re.split(r'\n\s*\n', body)
        for p in paragraphs:
            p = p.strip()
            if p and not p.startswith("#") and not p.startswith("![") and len(p) > 20:
                description = re.sub(r'\[([^\]]+)\]\([^)]+\)', r'\1', p)
                description = re.sub(r'[*_`]', '', description)
                description = description[:300]
                break

    if not description:
        description = f"Auto-discovered {component_type} from {dirname}"

    # Slug from directory name
    slug = re.sub(r'[^a-z0-9]+', '-', dirname.lower()).strip('-')

    # Try to find version from package.json or pyproject.toml
    version = None
    pkg_json = os.path.join(dirpath, "package.json")
    if os.path.isfile(pkg_json):
        try:
            with open(pkg_json) as f:
                pkg = json.load(f)
                version = pkg.get("version")
        except Exception:
            pass

    pyproject = os.path.join(dirpath, "pyproject.toml")
    if not version and os.path.isfile(pyproject):
        try:
            with open(pyproject) as f:
                for line in f:
                    m = re.match(r'version\s*=\s*["\']([^"\']+)["\']', line)
                    if m:
                        version = m.group(1)
                        break
        except Exception:
            pass

    # Extract tags from keywords in package.json or from content
    tags = []
    if os.path.isfile(pkg_json):
        try:
            with open(pkg_json) as f:
                pkg = json.load(f)
                tags = pkg.get("keywords", [])[:10]
        except Exception:
            pass

    if not tags:
        tag_candidates = re.findall(r'`([a-z][a-z0-9_-]{2,20})`', readme_lower[:2000])
        tags = list(set(tag_candidates))[:5]

    # Extract author
    author = None
    if os.path.isfile(pkg_json):
        try:
            with open(pkg_json) as f:
                pkg = json.load(f)
                a = pkg.get("author", "")
                if isinstance(a, dict):
                    author = a.get("name")
                elif isinstance(a, str):
                    author = a
        except Exception:
            pass

    return {
        "slug": slug,
        "name": name,
        "component_type": component_type,
        "description": description,
        "long_description": readme[:5000],
        "version": f"v{version}" if version and not version.startswith("v") else (version or "v1.0.0"),
        "install_command": f"forge install {slug}",
        "author": author,
        "tags": tags,
        "icon": {"agent": "smart_toy", "skill": "psychology", "mcp_server": "dns"}.get(component_type, "smart_toy"),
        "icon_color": {"agent": "text-primary", "skill": "text-amber-500", "mcp_server": "text-purple-500"}.get(component_type, "text-primary"),
    }


def _extract_howto(dirpath: str, readme_content: str) -> Optional[str]:
    """
    Extract how-to guide from a component directory (Issue #4).
    Looks for HOWTO.md, GUIDE.md, docs/howto.md, or extracts from README.
    """
    # Check for dedicated how-to files (skill.md first — primary convention for skills)
    for name in ["skill.md", "SKILL.md", "HOWTO.md", "howto.md", "GUIDE.md", "guide.md",
                  "docs/HOWTO.md", "docs/howto.md", "docs/guide.md",
                  "docs/getting-started.md", "docs/quickstart.md"]:
        path = os.path.join(dirpath, name)
        if os.path.isfile(path):
            try:
                with open(path, "r", encoding="utf-8", errors="ignore") as f:
                    return f.read(10000)
            except Exception:
                pass

    # Fall back to extracting how-to sections from README
    howto_patterns = [
        r'(?:^|\n)#{1,3}\s*(?:How[ -]?to|Getting Started|Quick Start|Installation|Usage|Setup)\s*\n([\s\S]*?)(?=\n#{1,3}\s|\Z)',
    ]

    for pattern in howto_patterns:
        match = re.search(pattern, readme_content, re.IGNORECASE)
        if match:
            section = match.group(0).strip()
            if len(section) > 50:
                return section[:5000]

    return None
