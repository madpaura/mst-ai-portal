import os
import re
import json
import shutil
import asyncio
import tempfile
import subprocess
import httpx
from typing import Optional
from loguru import logger as log


# Per-type key used inside the repo-root MANIFEST.json (mirrors madpaura/skills).
_MANIFEST_KEYS = {"skill": "skills", "agent": "agents", "mcp": "mcp"}

# Per-git-command wall-clock cap. The overall publish/delete budget is enforced
# by the caller (settings.ARTIFACT_*_TIMEOUT); this is a per-step safety net.
_GIT_CMD_TIMEOUT = 180


def _manifest_key(artifact_type: str) -> str:
    return _MANIFEST_KEYS.get(artifact_type, f"{artifact_type}s")


def _parse_github_url(url: str) -> tuple[str, str, str]:
    """Returns (host, owner, repo) from various GitHub URL formats."""
    # Handles HTTPS: https://github.example.com/owner/repo.git
    https_match = re.match(r'https?://([^/]+)/([^/]+)/([^/.]+)', url)
    if https_match:
        host = https_match.group(1)
        owner = https_match.group(2)
        repo = https_match.group(3).removesuffix('.git')
        return host, owner, repo
    # Handles SSH: git@github.example.com:owner/repo.git
    ssh_match = re.match(r'git@([^:]+):([^/]+)/([^/.]+)', url)
    if ssh_match:
        host = ssh_match.group(1)
        owner = ssh_match.group(2)
        repo = ssh_match.group(3).removesuffix('.git')
        return host, owner, repo
    raise ValueError(f"Cannot parse GitHub URL: {url!r}")


def _api_base(host: str) -> str:
    """Returns the REST API base URL for the given GitHub host."""
    if host == "api.github.com" or host == "github.com":
        return "https://api.github.com"
    # GitHub Enterprise Server uses /api/v3
    return f"https://{host}/api/v3"


async def test_connection(config: dict) -> dict:
    """
    Verifies token validity, repo access, and branch existence.
    Returns a dict with: ok (bool), checks (list of step results), error (str|None).
    """
    token = (config.get("token") or "").strip()
    branch = (config.get("branch") or "main").strip()
    url = (config.get("url") or "").strip()

    checks: list[dict] = []

    def step(name: str, ok: bool, detail: str) -> dict:
        entry = {"name": name, "ok": ok, "detail": detail}
        checks.append(entry)
        return entry

    if not url:
        step("Repository URL", False, "No URL configured")
        return {"ok": False, "checks": checks, "error": "No repository URL configured"}

    if not token:
        step("Token present", False, "No token configured")
        return {"ok": False, "checks": checks, "error": "No GitHub token configured"}

    step("Token present", True, "Token is set")

    try:
        host, owner, repo = _parse_github_url(url)
    except ValueError as exc:
        step("Parse URL", False, str(exc))
        return {"ok": False, "checks": checks, "error": str(exc)}

    step("Parse URL", True, f"{owner}/{repo}")

    api = _api_base(host)
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }

    async with httpx.AsyncClient(timeout=15.0, verify=False) as client:
        # 1. Verify token by calling /user
        r = await client.get(f"{api}/user", headers=headers)
        if r.status_code == 401:
            step("Token valid", False, "Token rejected (401 Unauthorized)")
            return {"ok": False, "checks": checks, "error": "GitHub token is invalid or expired"}
        if r.status_code != 200:
            step("Token valid", False, f"Unexpected status {r.status_code}")
            return {"ok": False, "checks": checks, "error": f"GitHub API error: {r.status_code}"}
        login = r.json().get("login", "unknown")
        step("Token valid", True, f"Authenticated as @{login}")

        # 2. Verify repo access
        r = await client.get(f"{api}/repos/{owner}/{repo}", headers=headers)
        if r.status_code == 404:
            step("Repo accessible", False, f"{owner}/{repo} not found or no access")
            return {"ok": False, "checks": checks, "error": f"Repository {owner}/{repo} not found or token lacks access"}
        if r.status_code == 403:
            step("Repo accessible", False, "Token lacks repo scope")
            return {"ok": False, "checks": checks, "error": "Token does not have 'repo' scope for this repository"}
        if r.status_code != 200:
            step("Repo accessible", False, f"Status {r.status_code}")
            return {"ok": False, "checks": checks, "error": f"Cannot access repo: {r.status_code}"}
        repo_data = r.json()
        visibility = "private" if repo_data.get("private") else "public"
        step("Repo accessible", True, f"{repo_data['full_name']} ({visibility}), default branch: {repo_data.get('default_branch', '?')}")

        # 3. Verify branch exists
        r = await client.get(
            f"{api}/repos/{owner}/{repo}/branches/{branch}",
            headers=headers,
        )
        if r.status_code == 404:
            step("Branch exists", False, f"Branch '{branch}' not found")
            return {"ok": False, "checks": checks, "error": f"Branch '{branch}' does not exist in {owner}/{repo}"}
        if r.status_code != 200:
            step("Branch exists", False, f"Status {r.status_code}")
            return {"ok": False, "checks": checks, "error": f"Cannot verify branch: {r.status_code}"}
        step("Branch exists", True, f"Branch '{branch}' confirmed")

        # 4. Check write permission (push access)
        perms = repo_data.get("permissions", {})
        can_push = perms.get("push", False)
        if not can_push:
            step("Write access", False, "Token has read-only access to this repo")
            return {"ok": False, "checks": checks, "error": "Token does not have write access to this repository"}
        step("Write access", True, "Token has push permissions")

    return {"ok": True, "checks": checks, "error": None}


# ── Git plumbing (clone → edit locally → single commit/push) ──────────────────

def _authed_https_url(url: str, token: str) -> str:
    """Return an HTTPS clone URL with the token embedded (handles SSH input too)."""
    url = url.strip()
    m = re.match(r'git@([^:]+):(.+)', url)  # git@host:owner/repo(.git) → https
    if m:
        url = f"https://{m.group(1)}/{m.group(2)}"
    url = re.sub(r'^(https?://)[^@/]+@', r'\1', url)  # strip any existing creds
    url = url.rstrip('/')
    if url.endswith('.git'):
        url = url[:-4]
    url = f"{url}.git"
    cred = f"oauth2:{token}" if "gitlab" in url.lower() else f"x-access-token:{token}"
    return re.sub(r'^(https?://)', rf'\1{cred}@', url)


def _redact(text: str) -> str:
    """Strip embedded credentials (https://user:token@host) from git output."""
    return re.sub(r'(https?://)[^@/\s]+@', r'\1***@', text or '')


def _run_git(args: list[str], cwd: Optional[str] = None):
    """Run a git command, raising ValueError (with redacted output) on failure."""
    env = {
        **os.environ,
        "GIT_TERMINAL_PROMPT": "0",
        "GIT_SSL_NO_VERIFY": "true",
    }
    proc = subprocess.run(
        ["git", "-c", "http.sslVerify=false", *args],
        cwd=cwd, capture_output=True, text=True,
        timeout=_GIT_CMD_TIMEOUT, env=env,
    )
    if proc.returncode != 0:
        detail = _redact((proc.stderr or proc.stdout or "").strip())[:400]
        raise ValueError(f"git {args[0]} failed: {detail}")
    return proc


def _git_target(config: dict) -> tuple:
    """Validate config and return (host, owner, repo, branch, base_folder, clone_url)."""
    token = (config.get("token") or "").strip()
    branch = (config.get("branch") or "main").strip()
    base_folder = (config.get("folder") or "").strip().strip("/")
    if not token:
        raise ValueError("GitHub token is not configured for this artifact type")
    if not config.get("url"):
        raise ValueError("GitHub URL is not configured for this artifact type")
    host, owner, repo = _parse_github_url(config["url"])
    clone_url = _authed_https_url(config["url"], token)
    return host, owner, repo, branch, base_folder, clone_url


def _safe_join(base: str, rel: str) -> str:
    """Join repo-relative path safely, rejecting traversal outside the artifact dir."""
    dest = os.path.normpath(os.path.join(base, rel))
    base_norm = os.path.normpath(base)
    if dest != base_norm and not dest.startswith(base_norm + os.sep):
        raise ValueError(f"Unsafe file path in submission: {rel!r}")
    return dest


def _commit_and_push(repo_dir: str, branch: str, message: str) -> bool:
    """Stage everything and push one commit. Returns False if there was nothing to do."""
    _run_git(["add", "-A"], cwd=repo_dir)
    status = subprocess.run(
        ["git", "status", "--porcelain"], cwd=repo_dir,
        capture_output=True, text=True, timeout=30,
    )
    if not status.stdout.strip():
        log.info("No changes to push for {}", repo_dir)
        return False
    _run_git(
        ["-c", "user.email=portal@mst-ai", "-c", "user.name=MST AI Portal",
         "commit", "-m", message],
        cwd=repo_dir,
    )
    _run_git(["push", "origin", f"HEAD:{branch}"], cwd=repo_dir)
    return True


# ── Manifest / README maintenance (pure, operate on local files) ──────────────

def _pick_entry(file_names: list[str]) -> str:
    lower = {f.lower(): f for f in file_names}
    for pref in ("skill.md", "agent.md", "mcp.md", "readme.md"):
        if pref in lower:
            return lower[pref]
    mds = [f for f in file_names if f.lower().endswith(".md")]
    if mds:
        return mds[0]
    return file_names[0] if file_names else "README.md"


def _build_manifest_entry(
    name: str, version: str, description: str, tags: list,
    file_names: list[str], author: str,
    license: str = "MIT", min_claude: str = "3.5",
) -> dict:
    entry = _pick_entry(file_names)
    refs = [f for f in file_names if f.lower().endswith(".md") and f != entry]
    return {
        "name": name,
        "version": version,
        "description": description or "",
        "tags": tags or [],
        "entry": entry,
        "references": refs,
        "minClaudeVersion": min_claude,
        "author": author or "admin",
        "license": license,
    }


def _write_manifest(repo_dir: str, artifact_type: str, entry: dict):
    key = _manifest_key(artifact_type)
    path = os.path.join(repo_dir, "MANIFEST.json")
    manifest: dict = {}
    if os.path.isfile(path):
        try:
            with open(path, "r", encoding="utf-8") as fh:
                manifest = json.loads(fh.read()) or {}
        except (json.JSONDecodeError, OSError):
            manifest = {}
    arr = manifest.get(key)
    if not isinstance(arr, list):
        arr = []
    arr = [e for e in arr if e.get("name") != entry["name"]]
    arr.append(entry)
    arr.sort(key=lambda e: e.get("name", ""))
    manifest[key] = arr
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(json.dumps(manifest, indent=2) + "\n")


def _remove_from_manifest(repo_dir: str, artifact_type: str, name: str):
    key = _manifest_key(artifact_type)
    path = os.path.join(repo_dir, "MANIFEST.json")
    if not os.path.isfile(path):
        return
    try:
        with open(path, "r", encoding="utf-8") as fh:
            manifest = json.loads(fh.read())
    except (json.JSONDecodeError, OSError):
        return
    arr = manifest.get(key)
    if not isinstance(arr, list):
        return
    new_arr = [e for e in arr if e.get("name") != name]
    if len(new_arr) == len(arr):
        return
    manifest[key] = new_arr
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(json.dumps(manifest, indent=2) + "\n")


def _upsert_readme_bullet(raw: str, name: str, bullet: str) -> str:
    lines = raw.split("\n")
    needle = f"- **{name}**"
    for i, ln in enumerate(lines):
        if ln.strip().startswith(needle):
            lines[i] = bullet
            return "\n".join(lines)
    for i, ln in enumerate(lines):
        if ln.strip().lower() == "## contents":
            j = i + 1
            while j < len(lines) and lines[j].strip() == "":
                j += 1
            k = j
            while k < len(lines) and lines[k].strip().startswith("-"):
                k += 1
            lines.insert(k, bullet)
            return "\n".join(lines)
    return raw.rstrip() + f"\n\n## Contents\n\n{bullet}\n"


def _remove_readme_bullet(raw: str, name: str) -> str:
    needle = f"- **{name}**"
    return "\n".join(ln for ln in raw.split("\n") if not ln.strip().startswith(needle))


def _write_readme(repo_dir: str, artifact_type: str, name: str, description: Optional[str]):
    bullet = f"- **{name}** — {description or 'No description provided.'}"
    path = os.path.join(repo_dir, "README.md")
    if os.path.isfile(path):
        with open(path, "r", encoding="utf-8") as fh:
            raw = fh.read()
        content = _upsert_readme_bullet(raw, name, bullet)
        if content == raw:
            return
    else:
        title = {"skill": "Claude Skills", "agent": "Claude Agents", "mcp": "MCP Servers"}.get(
            artifact_type, "Artifacts")
        content = (
            f"# {title}\n\nA curated collection of {artifact_type}s "
            f"published from the MST AI Portal.\n\n## Contents\n\n{bullet}\n"
        )
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(content)


def _remove_readme(repo_dir: str, name: str):
    path = os.path.join(repo_dir, "README.md")
    if not os.path.isfile(path):
        return
    with open(path, "r", encoding="utf-8") as fh:
        raw = fh.read()
    new = _remove_readme_bullet(raw, name)
    if new != raw:
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(new)


# ── Sync workers (run off the event loop via asyncio.to_thread) ────────────────

def _push_sync(
    config: dict, artifact_name: str, files: list[dict],
    version: Optional[str], description: Optional[str], tags: Optional[list],
    author: Optional[str], artifact_type: str,
) -> str:
    host, owner, repo, branch, base_folder, clone_url = _git_target(config)
    folder_rel = f"{base_folder}/{artifact_name}" if base_folder else artifact_name

    tmp = tempfile.mkdtemp(prefix="artifact_push_")
    try:
        _run_git(["clone", "--depth", "1", "--branch", branch, clone_url, tmp])

        # Rewrite the artifact folder from scratch so add / update / delete across
        # versions all land in one commit (stale files are pruned by the wipe).
        target_dir = _safe_join(tmp, folder_rel)
        if os.path.isdir(target_dir):
            shutil.rmtree(target_dir)
        for file_obj in files:
            dest = _safe_join(target_dir, file_obj["name"])
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            with open(dest, "w", encoding="utf-8") as fh:
                fh.write(file_obj["content"])

        # Refresh repo-root MANIFEST.json + README.md (madpaura/skills format).
        _write_manifest(
            tmp, artifact_type,
            _build_manifest_entry(
                artifact_name, version or "1.0.0", description or "",
                tags or [], [f["name"] for f in files], author or "admin",
            ),
        )
        _write_readme(tmp, artifact_type, artifact_name, description)

        msg = f"feat(artifacts): publish {artifact_name}" + (f" v{version}" if version else "")
        _commit_and_push(tmp, branch, msg)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    return f"https://{host}/{owner}/{repo}/tree/{branch}/{folder_rel}"


def _delete_sync(config: dict, artifact_type: str, artifact_name: str):
    host, owner, repo, branch, base_folder, clone_url = _git_target(config)
    folder_rel = f"{base_folder}/{artifact_name}" if base_folder else artifact_name

    tmp = tempfile.mkdtemp(prefix="artifact_del_")
    try:
        _run_git(["clone", "--depth", "1", "--branch", branch, clone_url, tmp])

        target_dir = _safe_join(tmp, folder_rel)
        if os.path.isdir(target_dir):
            shutil.rmtree(target_dir)
        _remove_from_manifest(tmp, artifact_type, artifact_name)
        _remove_readme(tmp, artifact_name)

        _commit_and_push(tmp, branch, f"chore(artifacts): remove {artifact_name}")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


# ── Public operations ─────────────────────────────────────────────────────────

async def push_artifact(
    config: dict,
    artifact_name: str,
    files: list[dict],
    version: Optional[str] = None,
    description: Optional[str] = None,
    tags: Optional[list] = None,
    author: Optional[str] = None,
    artifact_type: str = "skill",
) -> str:
    """
    Clone the configured repo, write {folder}/{artifact_name}/ (add/update/delete in
    one shot), refresh the repo-root MANIFEST.json + README.md, and push a single
    commit. Returns the URL of the artifact folder on GitHub.
    """
    return await asyncio.to_thread(
        _push_sync, config, artifact_name, files,
        version, description, tags, author, artifact_type,
    )


async def delete_artifact(config: dict, artifact_type: str, artifact_name: str):
    """Remove an artifact's folder from GitHub and drop it from MANIFEST.json + README.md (one commit)."""
    await asyncio.to_thread(_delete_sync, config, artifact_type, artifact_name)
