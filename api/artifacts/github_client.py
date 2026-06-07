import re
import json
import base64
import httpx
from typing import Optional
from loguru import logger as log


# Per-type key used inside the repo-root MANIFEST.json (mirrors madpaura/skills).
_MANIFEST_KEYS = {"skill": "skills", "agent": "agents", "mcp": "mcp"}


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


def _resolve_target(config: dict) -> tuple:
    """Validate config and return (host, owner, repo, api, headers, base_api, branch, base_folder)."""
    token = (config.get("token") or "").strip()
    branch = (config.get("branch") or "main").strip()
    base_folder = (config.get("folder") or "").strip().strip("/")

    if not token:
        raise ValueError("GitHub token is not configured for this artifact type")
    if not config.get("url"):
        raise ValueError("GitHub URL is not configured for this artifact type")

    host, owner, repo = _parse_github_url(config["url"])
    api = _api_base(host)
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    base_api = f"{api}/repos/{owner}/{repo}/contents"
    return host, owner, repo, api, headers, base_api, branch, base_folder


async def _get_content(client, base_api, path, branch, headers) -> tuple:
    """Returns (text, sha) for a repo file, or (None, None) when it does not exist."""
    r = await client.get(f"{base_api}/{path}", headers=headers, params={"ref": branch})
    if r.status_code == 200:
        data = r.json()
        text = base64.b64decode(data["content"]).decode("utf-8")
        return text, data["sha"]
    return None, None


async def _put_content(client, base_api, path, branch, headers, text, message, sha=None):
    payload: dict = {
        "message": message,
        "content": base64.b64encode(text.encode("utf-8")).decode("ascii"),
        "branch": branch,
    }
    if sha:
        payload["sha"] = sha
    r = await client.put(f"{base_api}/{path}", headers=headers, json=payload)
    if r.status_code not in (200, 201):
        msg = r.json().get("message", "unknown error")
        log.error("GitHub put failed {} for {}: {}", r.status_code, path, msg)
        raise ValueError(f"GitHub API error {r.status_code}: {msg}")
    log.info("Wrote GitHub file: {}", path)


async def _delete_content(client, base_api, path, branch, headers, sha, message):
    payload = {"message": message, "sha": sha, "branch": branch}
    r = await client.request("DELETE", f"{base_api}/{path}", headers=headers, json=payload)
    if r.status_code not in (200,):
        msg = r.json().get("message", "unknown error")
        log.error("GitHub delete failed {} for {}: {}", r.status_code, path, msg)
        raise ValueError(f"GitHub API error {r.status_code}: {msg}")
    log.info("Deleted GitHub file: {}", path)


# ── Manifest / README maintenance ─────────────────────────────────────────────

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


async def _update_manifest(client, base_api, branch, headers, artifact_type, entry):
    key = _manifest_key(artifact_type)
    raw, sha = await _get_content(client, base_api, "MANIFEST.json", branch, headers)
    manifest: dict = {}
    if raw:
        try:
            manifest = json.loads(raw)
        except json.JSONDecodeError:
            manifest = {}
    arr = manifest.get(key)
    if not isinstance(arr, list):
        arr = []
    arr = [e for e in arr if e.get("name") != entry["name"]]
    arr.append(entry)
    arr.sort(key=lambda e: e.get("name", ""))
    manifest[key] = arr
    content = json.dumps(manifest, indent=2) + "\n"
    await _put_content(
        client, base_api, "MANIFEST.json", branch, headers, content,
        f"chore(manifest): update {entry['name']} v{entry['version']}", sha,
    )


async def _remove_from_manifest(client, base_api, branch, headers, artifact_type, name):
    key = _manifest_key(artifact_type)
    raw, sha = await _get_content(client, base_api, "MANIFEST.json", branch, headers)
    if not raw:
        return
    try:
        manifest = json.loads(raw)
    except json.JSONDecodeError:
        return
    arr = manifest.get(key)
    if not isinstance(arr, list):
        return
    new_arr = [e for e in arr if e.get("name") != name]
    if len(new_arr) == len(arr):
        return
    manifest[key] = new_arr
    content = json.dumps(manifest, indent=2) + "\n"
    await _put_content(
        client, base_api, "MANIFEST.json", branch, headers, content,
        f"chore(manifest): remove {name}", sha,
    )


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


async def _update_readme(client, base_api, branch, headers, artifact_type, name, description):
    bullet = f"- **{name}** — {description or 'No description provided.'}"
    raw, sha = await _get_content(client, base_api, "README.md", branch, headers)
    if raw:
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
    await _put_content(
        client, base_api, "README.md", branch, headers, content,
        f"docs(readme): list {name}", sha,
    )


async def _delete_tree(client, base_api, branch, headers, path):
    """Recursively delete every file under a repo path. No-op if the path is absent."""
    r = await client.get(f"{base_api}/{path}", headers=headers, params={"ref": branch})
    if r.status_code == 404:
        return
    if r.status_code != 200:
        msg = r.json().get("message", "unknown error")
        raise ValueError(f"GitHub API error {r.status_code}: {msg}")
    items = r.json()
    if isinstance(items, dict):  # a single file was returned
        items = [items]
    for it in items:
        if it.get("type") == "dir":
            await _delete_tree(client, base_api, branch, headers, it["path"])
        else:
            await _delete_content(
                client, base_api, it["path"], branch, headers, it["sha"],
                f"chore(artifacts): remove {it['path']}",
            )


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
    Creates/updates files under {folder}/{artifact_name}/ in the configured repo,
    then refreshes the repo-root MANIFEST.json and README.md (madpaura/skills format).
    Returns the URL of the created folder on GitHub.
    """
    host, owner, repo, api, headers, base_api, branch, base_folder = _resolve_target(config)

    async with httpx.AsyncClient(timeout=30.0, verify=False) as client:
        for file_obj in files:
            fname = file_obj["name"]
            content = file_obj["content"]
            rel_path = f"{base_folder}/{artifact_name}/{fname}" if base_folder else f"{artifact_name}/{fname}"

            _, sha = await _get_content(client, base_api, rel_path, branch, headers)
            version_suffix = f" (v{version})" if version else ""
            action = "update" if sha else "add"
            await _put_content(
                client, base_api, rel_path, branch, headers, content,
                f"feat(artifacts): {action} {artifact_name}/{fname}{version_suffix}", sha,
            )

        # Maintain repo-level manifest + readme so the repo stays in the expected format.
        entry = _build_manifest_entry(
            artifact_name, version or "1.0.0", description or "",
            tags or [], [f["name"] for f in files], author or "admin",
        )
        await _update_manifest(client, base_api, branch, headers, artifact_type, entry)
        await _update_readme(client, base_api, branch, headers, artifact_type, artifact_name, description)

    folder_path = f"{base_folder}/{artifact_name}" if base_folder else artifact_name
    return f"https://{host}/{owner}/{repo}/tree/{branch}/{folder_path}"


async def delete_artifact(config: dict, artifact_type: str, artifact_name: str):
    """Remove an artifact's folder from GitHub and drop it from MANIFEST.json + README.md."""
    host, owner, repo, api, headers, base_api, branch, base_folder = _resolve_target(config)
    folder_path = f"{base_folder}/{artifact_name}" if base_folder else artifact_name

    async with httpx.AsyncClient(timeout=30.0, verify=False) as client:
        await _delete_tree(client, base_api, branch, headers, folder_path)
        await _remove_from_manifest(client, base_api, branch, headers, artifact_type, artifact_name)
        raw, sha = await _get_content(client, base_api, "README.md", branch, headers)
        if raw:
            new = _remove_readme_bullet(raw, artifact_name)
            if new != raw:
                await _put_content(
                    client, base_api, "README.md", branch, headers, new,
                    f"docs(readme): remove {artifact_name}", sha,
                )
