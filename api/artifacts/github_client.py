import re
import base64
import httpx
from typing import Optional
from loguru import logger as log


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


async def push_artifact(
    config: dict,
    artifact_name: str,
    files: list[dict],
    version: Optional[str] = None,
) -> str:
    """
    Creates/updates files under {folder}/{artifact_name}/ in the configured repo.
    Returns the URL of the created folder on GitHub.
    """
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

    async with httpx.AsyncClient(timeout=30.0, verify=False) as client:
        for file_obj in files:
            fname = file_obj["name"]
            content = file_obj["content"]

            rel_path = f"{base_folder}/{artifact_name}/{fname}" if base_folder else f"{artifact_name}/{fname}"
            content_b64 = base64.b64encode(content.encode("utf-8")).decode("ascii")

            # Fetch existing SHA (required for updates)
            sha = None
            check = await client.get(
                f"{base_api}/{rel_path}",
                headers=headers,
                params={"ref": branch},
            )
            if check.status_code == 200:
                sha = check.json().get("sha")

            version_suffix = f" (v{version})" if version else ""
            action = "update" if sha else "add"
            payload: dict = {
                "message": f"feat(artifacts): {action} {artifact_name}/{fname}{version_suffix}",
                "content": content_b64,
                "branch": branch,
            }
            if sha:
                payload["sha"] = sha

            resp = await client.put(
                f"{base_api}/{rel_path}",
                headers=headers,
                json=payload,
            )
            if resp.status_code not in (200, 201):
                msg = resp.json().get("message", "unknown error")
                log.error("GitHub push failed {}: {}", resp.status_code, msg)
                raise ValueError(f"GitHub API error {resp.status_code}: {msg}")

            log.info("Pushed artifact file to GitHub: {}", rel_path)

    folder_path = f"{base_folder}/{artifact_name}" if base_folder else artifact_name
    return f"https://{host}/{owner}/{repo}/tree/{branch}/{folder_path}"
