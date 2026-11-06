"""SSH bridge to the mmrag host.

This module is the whole contract between the portal and mmrag, which runs on a
different machine: `setup.sh <command>` run over SSH, plus parsing of what those
commands print. Nothing else in the portal should know how mmrag works.

`setup.sh` has no metrics command, so check_usage() is the one exception: it runs
read-only `kubectl top` and `kubectl exec` over the same connection. Every change
to a project still goes through `setup.sh`.

setup.sh behaviour the callers depend on:
  * `deploy` exits 0 even when services never turned ready, so success has to be
    confirmed with `status`.
  * `status` is `kubectl get pods,sts,deploy,svc,pvc`. A deployment still reads
    1/1 while a new pod crash-loops behind the old one, so health_from_status()
    reads pods as well as workloads. An unknown project exits 0 with no workloads
    listed, so it compares with the expected list.
  * `rotate-key` returns once the rollout has started, so callers have to wait
    for it with `status`.
  * `deploy` and `rotate-key` print the key, so all output is redacted before it
    can reach a log, the database or an API response.
  * `destroy` asks for the project name on stdin.
  * `backup` dumps through postgres-0, so it fails on a stopped project.
  * `list` is judged by its PROJECT header, not its exit status. Only the project
    names are read: its URLs are NodePorts, while users go through the portal's
    nginx (see space_urls()).
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

_WORKLOAD_RE = re.compile(r"^(?:deployment|statefulset)\.apps/(\S+)\s+(\d+)/(\d+)\s", re.MULTILINE)
_POD_RE = re.compile(r"^pod/(\S+)\s+(\d+)/(\d+)\s+(\S+)", re.MULTILINE)
# Pods on their way out, listed for a moment after a rollout or scale-down.
_POD_LEAVING = {"Terminating", "Completed", "Evicted"}
_POD_STARTING = {"Pending", "ContainerCreating", "PodInitializing"}

# Where each project keeps its data, as (service, kubectl target, path).
_DATA_VOLUMES = (
    ("postgres", "postgres-0", "/var/lib/postgresql/data"),
    ("neo4j", "neo4j-0", "/data"),
    ("rag-app", "deploy/rag-app", "/app/data"),
)
_USAGE_TIMEOUT = 60
_DU_TIMEOUT = 15
_TOP_RE = re.compile(r"^(\S+)\s+(\d+)(m?)\s+(\d+)(Ki|Mi|Gi|Ti)\s*$", re.MULTILINE)
_DU_RE = re.compile(r"^(\d+)\s+/", re.MULTILINE)
_DF_RE = re.compile(r"^\S+\s+(\d+)\s+\d+\s+(\d+)\s+(\d+)%\s+/", re.MULTILINE)
_MEMORY_UNITS = {"Ki": 2**10, "Mi": 2**20, "Gi": 2**30, "Ti": 2**40}


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


async def list_projects() -> set[str]:
    """Return the project names reported by `setup.sh list`."""
    result = await run(["list"], timeout=30)
    if not result.output.startswith("PROJECT"):
        raise RemoteError(f"`setup.sh list` failed: {result.output.strip()[-300:]}")
    return parse_list(result.output)


def parse_list(output: str) -> set[str]:
    rows = (line.split() for line in output.splitlines())
    return {parts[0] for parts in rows if len(parts) >= 3 and parts[0] != "PROJECT"}


def space_urls(slug: str) -> dict:
    """Links to a space, relative so they stay on the address the user reached
    the portal on. The nginx in front of the portal routes /mmrag/ to mmrag."""
    return {"api_url": f"/mmrag/{slug}/api/", "mgmt_url": f"/mmrag/{slug}/mgmt/"}


def expected_services() -> list[str]:
    return [s.strip() for s in settings.MMRAG_EXPECTED_SERVICES.split(",") if s.strip()]


def _pod_state(ready: str, total: str, status: str) -> Optional[str]:
    if status in _POD_LEAVING:
        return None
    if status == "Running":
        return "healthy" if ready == total else "starting"
    if status in _POD_STARTING or re.fullmatch(r"Init:\d+/\d+", status):
        return "starting"
    return "unhealthy"


def health_from_status(output: str) -> dict:
    """Turn `setup.sh status <slug>` output into {healthy, services}."""
    pods = _POD_RE.findall(output)
    services = []
    for name, ready, desired in _WORKLOAD_RE.findall(output):
        pod_states = {_pod_state(r, t, status) for pod, r, t, status in pods if pod.startswith(f"{name}-")}
        if int(desired) == 0:
            state = "stopped"
        elif "unhealthy" in pod_states:
            state = "unhealthy"
        elif int(ready) < int(desired) or "starting" in pod_states:
            state = "starting"
        else:
            state = "healthy"
        services.append({"service": name, "state": state})

    seen = {s["service"] for s in services}
    services += [{"service": name, "state": "missing"} for name in expected_services() if name not in seen]
    healthy = bool(services) and all(s["state"] == "healthy" for s in services)
    return {"healthy": healthy, "services": services}


async def check_health(slug: str) -> dict:
    result = await run(["status", slug], timeout=30)
    if not result.ok:
        return {"healthy": False, "services": [], "error": result.output.strip()[-300:]}
    return health_from_status(result.output)


def build_usage_command(slug: str) -> str:
    kubectl = f"kubectl -n {shlex.quote(f'mmrag-{slug}')}"
    steps = [f"echo ::top; {kubectl} top pods --no-headers 2>&1"]
    for service, target, path in _DATA_VOLUMES:
        probe = shlex.quote(f"timeout {_DU_TIMEOUT} du -sk {path}; df -Pk {path}")
        steps.append(f"echo ::disk {service}; {kubectl} exec {target} -- sh -c {probe} 2>&1")
    return "; ".join(steps)


def _sum_known(values: list) -> Optional[int]:
    known = [v for v in values if v is not None]
    return sum(known) if known else None


def parse_usage(output: str) -> dict:
    """Turn the output of build_usage_command() into per-service CPU, RAM and disk."""
    parts = re.split(r"^::(.+)$", output, flags=re.MULTILINE)
    sections = dict(zip(parts[1::2], parts[2::2]))
    top = sections.get("top", "")
    pods = _TOP_RE.findall(top)

    services = []
    node_disk = None
    for name in expected_services():
        rows = [p for p in pods if p[0].startswith(f"{name}-")]
        disk = sections.get(f"disk {name}", "")
        du, df = _DU_RE.search(disk), _DF_RE.search(disk)
        services.append({
            "service": name,
            "cpu_millicores": _sum_known([int(c) * (1 if m else 1000) for _, c, m, _, _ in rows]),
            "memory_bytes": _sum_known([int(v) * _MEMORY_UNITS[u] for _, _, _, v, u in rows]),
            "disk_bytes": int(du.group(1)) * 1024 if du else None,
        })
        if df and (node_disk is None or int(df.group(3)) > node_disk["used_percent"]):
            node_disk = {
                "size_bytes": int(df.group(1)) * 1024,
                "available_bytes": int(df.group(2)) * 1024,
                "used_percent": int(df.group(3)),
            }

    error = None
    if "Metrics API not available" in top:
        error = "CPU and RAM need metrics-server on the cluster"
    elif not pods and "No resources found" not in top:
        error = top.strip()[-300:] or None
    return {
        "services": services,
        "cpu_millicores": _sum_known([s["cpu_millicores"] for s in services]),
        "memory_bytes": _sum_known([s["memory_bytes"] for s in services]),
        "disk_bytes": _sum_known([s["disk_bytes"] for s in services]),
        "node_disk": node_disk,
        "error": error,
    }


async def check_usage(slug: str) -> dict:
    try:
        result = await _exec(build_usage_command(slug), _USAGE_TIMEOUT, None, redact)
    except RemoteError as exc:
        return {"services": [], "error": str(exc)}
    return parse_usage(result.output)


def parse_backup_path(output: str) -> Optional[str]:
    match = _BACKUP_RE.search(output)
    return match.group(1) if match else None
