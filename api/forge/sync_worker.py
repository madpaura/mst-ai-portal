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

                    # Check if component already exists
                    existing = await pool.fetchrow(
                        "SELECT id FROM forge_components WHERE slug = $1",
                        comp["slug"],
                    )

                    if existing:
                        # Update existing
                        await pool.execute(
                            """UPDATE forge_components SET
                                name=$1, description=$2, long_description=$3, version=$4,
                                git_repo_url=$5, git_ref=$6, last_synced_at=now(),
                                howto_guide=$7, updated_at=now()
                            WHERE slug=$8""",
                            comp["name"], comp["description"], comp.get("long_description"),
                            comp.get("version", latest_tag or "v0.0.0"),
                            git_url, comp["git_ref"], comp.get("howto_guide"),
                            comp["slug"],
                        )
                        components_updated += 1
                        await _append_log(pool, job_id, f"  Updated: {comp['name']} ({comp['slug']})")
                    else:
                        # Create new
                        await pool.execute(
                            """INSERT INTO forge_components
                                (slug, name, component_type, description, long_description,
                                 icon, icon_color, version, install_command, author, tags,
                                 git_repo_url, git_ref, last_synced_at, howto_guide)
                            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,now(),$14)""",
                            comp["slug"], comp["name"], comp["component_type"],
                            comp["description"], comp.get("long_description"),
                            comp.get("icon", "smart_toy"), comp.get("icon_color", "text-primary"),
                            comp.get("version", latest_tag or "v0.0.0"),
                            comp.get("install_command", f"forge install {comp['slug']}"),
                            comp.get("author", "Auto-discovered"),
                            comp.get("tags", []),
                            git_url, comp["git_ref"], comp.get("howto_guide"),
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
        print(f"[sync] Error in job {job_id}: {e}")
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


def _parse_component_from_readme(dirname: str, readme: str, dirpath: str) -> Optional[dict]:
    """Parse component metadata from a README or SKILL.md file."""
    # Parse YAML frontmatter if present (---\n...\n---)
    frontmatter: dict = {}
    body = readme
    fm_match = re.match(r'^---\s*\n(.*?)\n---\s*\n?(.*)', readme, re.DOTALL)
    if fm_match:
        fm_text = fm_match.group(1)
        body = fm_match.group(2)
        for line in fm_text.split("\n"):
            m = re.match(r'^(\w[\w-]*)\s*:\s*(.+)$', line.strip())
            if m:
                frontmatter[m.group(1).strip()] = m.group(2).strip()

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
    # Check for dedicated how-to files
    for name in ["HOWTO.md", "howto.md", "GUIDE.md", "guide.md",
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
