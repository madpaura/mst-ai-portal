"""Poll auto-processing status for one or more videos (slug or UUID)."""
from __future__ import annotations

import time

import click

from ..lib import progress as ui
from ..lib.api import APIClient, APIError
from ..lib.auth import resolve

_TERMINAL = {"ready", "failed", "error", "done"}
_RUNNING  = {"queued", "processing", "pending"}

_COLOUR = {
    "ready":      "green",
    "done":       "green",
    "processing": "cyan",
    "pending":    "cyan",
    "queued":     "yellow",
    "failed":     "red",
    "error":      "red",
    "unknown":    "white",
}


def _overall(data: dict) -> str:
    """Derive a single overall status from the API response."""
    jobs: dict = data.get("jobs") or {}
    if not jobs:
        # No jobs yet — check transcript_status as fallback
        ts = data.get("transcript_status") or "queued"
        return ts
    statuses = [j.get("status", "unknown") for j in jobs.values()]
    if any(s in ("failed", "error") for s in statuses):
        return "failed"
    if any(s in _RUNNING for s in statuses):
        return "processing"
    if all(s in _TERMINAL for s in statuses):
        return "ready"
    return statuses[0]


def _display_one(label: str, data: dict) -> None:
    """Print a summary line plus per-job detail for one video."""
    if "error" in data and "jobs" not in data:
        # Fetch-level error stored by poll_once
        ui.console.print(f"  [red]{label}[/red]  [red]error[/red] — {data['error']}")
        return

    overall = _overall(data)
    col = _COLOUR.get(overall, "white")
    ui.console.print(f"  [bold]{label}[/bold]  [{col}]{overall}[/{col}]"
                     + ("  [dim](auto_mode off)[/dim]" if not data.get("auto_mode") else ""))

    jobs: dict = data.get("jobs") or {}
    for kind, info in jobs.items():
        st = info.get("status", "unknown")
        c  = _COLOUR.get(st, "white")
        err = f"  — {info['error']}" if info.get("error") else ""
        ui.console.print(f"    [dim]{kind:20s}[/dim] [{c}]{st}[/{c}]{err}")

    ts = data.get("transcript_status")
    if ts:
        c = _COLOUR.get(ts, "white")
        te = f"  — {data['transcript_error']}" if data.get("transcript_error") else ""
        ui.console.print(f"    [dim]{'transcript':20s}[/dim] [{c}]{ts}[/{c}]{te}")


@click.command("status")
@click.argument("video_ids", nargs=-1, required=True, metavar="SLUG_OR_ID...")
@click.option("--api-url", envvar="MST_API_URL", default=None, help="Portal API base URL")
@click.option("--token", envvar="MST_TOKEN", default=None, help="JWT token (skips login)")
@click.option("--username", "-u", envvar="MST_USERNAME", default=None, help="Username")
@click.option("--password", "-p", envvar="MST_PASSWORD", default=None, help="Password")
@click.option("--watch", is_flag=True, help="Poll every 10 s until all jobs finish")
@click.option("--interval", type=int, default=10, show_default=True, help="Poll interval (seconds)")
def status(
    video_ids: tuple[str, ...],
    api_url: str | None,
    token: str | None,
    username: str | None,
    password: str | None,
    watch: bool,
    interval: int,
) -> None:
    """Check auto-processing status for one or more videos.

    Accepts either a video UUID or slug.

    \b
    Examples:
      mst-ingest status my-video-slug
      mst-ingest status 2ea488fb-246e-4d46-ae34-a4cad256d9f5
      mst-ingest status slug-a slug-b --watch
    """
    try:
        url, tok = resolve(api_url=api_url, token=token, username=username, password=password)
    except APIError as exc:
        ui.error(str(exc))
        raise SystemExit(1)

    client = APIClient(url, tok)

    def poll_once() -> dict[str, dict]:
        results = {}
        for vid in video_ids:
            try:
                results[vid] = client.get_auto_status(vid)
            except APIError as exc:
                results[vid] = {"error": str(exc)}
        return results

    def display(results: dict[str, dict]) -> None:
        ui.console.print()
        for label, data in results.items():
            _display_one(label, data)
        ui.console.print()

    if not watch:
        display(poll_once())
        return

    while True:
        results = poll_once()
        ui.console.clear()
        display(results)
        pending = [
            v for v, d in results.items()
            if _overall(d) in _RUNNING
        ]
        if not pending:
            break
        ui.console.print(f"  [dim]Refreshing in {interval}s — Ctrl-C to stop[/dim]")
        time.sleep(interval)
