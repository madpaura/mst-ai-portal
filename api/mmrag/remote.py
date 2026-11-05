"""SSH bridge to the mmrag host.

This module is the whole contract between the portal and mmrag, which runs on a
different machine: `setup.sh <command>` run over SSH, plus parsing of what those
commands print. Nothing else in the portal should know how mmrag works.

setup.sh behaviour the callers depend on:
  * `deploy` exits 0 even when services never turned healthy, so success has to
    be confirmed with `status`.
  * `status` is `docker compose ps` without -a, so a crashed container is simply
    absent from the output. health_from_status() compares with the expected list.
  * `rotate-key` prints the new key, so all output is redacted before it can
    reach a log, the database or an API response.
  * `destroy` asks for the project name on stdin.
  * `list` exits 1 after printing everything when the last project directory has
    no .env, which includes a host with no projects yet. Its header shows it ran.
"""
import asyncio
import re
import shlex
from dataclasses import dataclass
from typing import Awaitable, Callable, Optional

import asyncssh
from loguru import logger as log

from config import settings

# Must stay in step with valid_name() in mmrag's setup.sh.
SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,30}$")

_ANSI_RE = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")
_KEY_LINE_RE = re.compile(r"^(\s*key\s*:\s*)\S+", re.MULTILINE)
_KEY_TOKEN_RE = re.compile(r"mmr_[A-Za-z0-9]+")
_BACKUP_RE = re.compile(r"backup:\s+(\S+)")

_BAD_STATE_RE = re.compile(r"\b(Exited|Restarting|Dead|Paused|Created|Removing)\b")


class RemoteError(Exception):
    """The mmrag host could not be reached or a command could not be run."""


class RemoteNotConfigured(RemoteError):
    """MMRAG_SSH_* settings are missing."""


@dataclass
class RemoteResult:
    exit_status: int
    output: str

    @property
    def ok(self) -> bool:
        return self.exit_status == 0


def is_configured() -> bool:
    return bool(
        settings.MMRAG_SSH_HOST and settings.MMRAG_SSH_USER
        and settings.MMRAG_SSH_KEY_PATH and settings.MMRAG_REMOTE_PATH
    )


def clean(text: str) -> str:
    """Strip the terminal colours setup.sh prints."""
    return _ANSI_RE.sub("", text)


def redact(text: str) -> str:
    """Remove project access keys from setup.sh output."""
    text = _KEY_LINE_RE.sub(r"\1[redacted]", text)
    return _KEY_TOKEN_RE.sub("[redacted]", text)


def build_command(args: list[str], stdin_text: Optional[str] = None) -> str:
    quoted = " ".join(shlex.quote(a) for a in args)
    command = f"cd {shlex.quote(settings.MMRAG_REMOTE_PATH)} && ./setup.sh {quoted}"
    if stdin_text is not None:
        # Pipe the answer in rather than writing to the channel, so a prompt can
        # never be left waiting on an open stdin.
        command = f"printf '%s\\n' {shlex.quote(stdin_text)} | ( {command} )"
    return command


async def _exec(
    command: str,
    timeout: float,
    on_line: Optional[Callable[[str], Awaitable[None]]],
    sanitize: Callable[[str], str],
) -> RemoteResult:
    if not is_configured():
        raise RemoteNotConfigured("MMRAG SSH settings are not configured")

    # An unset MMRAG_SSH_KNOWN_HOSTS uses ~/.ssh/known_hosts. Host key checking is
    # never turned off: this connection carries access keys and destroys data.
    known_hosts = settings.MMRAG_SSH_KNOWN_HOSTS or ()
    lines: list[str] = []
    try:
        async with asyncio.timeout(timeout):
            async with asyncssh.connect(
                settings.MMRAG_SSH_HOST,
                port=settings.MMRAG_SSH_PORT,
                username=settings.MMRAG_SSH_USER,
                client_keys=[settings.MMRAG_SSH_KEY_PATH],
                known_hosts=known_hosts,
                agent_path=None,
                connect_timeout=20,
                keepalive_interval=30,
            ) as conn:
                process = await conn.create_process(
                    command, stderr=asyncssh.STDOUT, encoding="utf-8", errors="replace",
                )
                process.stdin.write_eof()
                async for raw in process.stdout:
                    if not raw:
                        continue
                    line = sanitize(clean(raw))
                    lines.append(line)
                    if on_line:
                        await on_line(line)
                completed = await process.wait()
                exit_status = completed.exit_status
    except TimeoutError as exc:
        raise RemoteError(f"Timed out talking to the mmrag host (limit {int(timeout)}s)") from exc
    except (asyncssh.Error, OSError) as exc:
        raise RemoteError(f"SSH to the mmrag host failed: {sanitize(str(exc))}") from exc
    return RemoteResult(exit_status if exit_status is not None else 255, "".join(lines))


async def run(
    args: list[str],
    timeout: float = 60,
    on_line: Optional[Callable[[str], Awaitable[None]]] = None,
    stdin_text: Optional[str] = None,
) -> RemoteResult:
    """Run `setup.sh <args>`. All output is redacted."""
    log.info("mmrag remote: setup.sh {}", " ".join(args))
    return await _exec(build_command(args, stdin_text), timeout, on_line, redact)


async def fetch_key(slug: str) -> str:
    """Return the access key of a project. Callers must never store or log it."""
    log.info("mmrag remote: setup.sh key {}", slug)
    result = await _exec(build_command(["key", slug]), 30, None, lambda line: line)
    match = re.search(r"^key\s*:\s*(\S+)", result.output, re.MULTILINE)
    if not result.ok or not match:
        raise RemoteError(f"Could not read the access key: {redact(result.output).strip()[-300:]}")
    return match.group(1)


async def list_projects() -> dict[str, dict]:
    """Return {project: {api_url, mgmt_url}} as reported by `setup.sh list`."""
    result = await run(["list"], timeout=30)
    if not result.output.startswith("PROJECT"):
        raise RemoteError(f"`setup.sh list` failed: {result.output.strip()[-300:]}")
    return parse_list(result.output)


def parse_list(output: str) -> dict[str, dict]:
    projects: dict[str, dict] = {}
    for line in output.splitlines():
        parts = line.split()
        if len(parts) >= 3 and parts[0] != "PROJECT":
            projects[parts[0]] = {"api_url": parts[1], "mgmt_url": parts[2]}
    return projects


def expected_services() -> list[str]:
    return [s.strip() for s in settings.MMRAG_EXPECTED_SERVICES.split(",") if s.strip()]


def health_from_status(slug: str, output: str) -> dict:
    """Turn `setup.sh status <slug>` output into {healthy, services}."""
    seen: dict[str, str] = {}
    container_re = re.compile(rf"^mmrag-{re.escape(slug)}-(.+?)-\d+\s")
    for line in output.splitlines():
        match = container_re.match(line)
        if not match:
            continue
        if "(unhealthy)" in line or _BAD_STATE_RE.search(line):
            state = "unhealthy"
        elif "(health: starting)" in line:
            state = "starting"
        elif "(healthy)" in line:
            state = "healthy"
        else:
            state = "running"
        seen[match.group(1)] = state

    services = [{"service": name, "state": state} for name, state in seen.items()]
    services += [{"service": name, "state": "missing"} for name in expected_services() if name not in seen]
    healthy = bool(services) and all(s["state"] in ("healthy", "running") for s in services)
    return {"healthy": healthy, "services": services}


async def check_health(slug: str) -> dict:
    result = await run(["status", slug], timeout=30)
    if not result.ok:
        return {"healthy": False, "services": [], "error": result.output.strip()[-300:]}
    return health_from_status(slug, result.output)


def parse_backup_path(output: str) -> Optional[str]:
    match = _BACKUP_RE.search(output)
    return match.group(1) if match else None
