"""Poll auto-processing status for one or more video IDs."""
from __future__ import annotations

import time

import click

from ..lib import progress as ui
from ..lib.api import APIClient, APIError
from ..lib.auth import resolve

_TERMINAL = {"ready", "failed", "error"}
_RUNNING  = {"queued", "processing"}


@click.command("status")
@click.argument("video_ids", nargs=-1, required=True)
@click.option("--api-url", envvar="MST_API_URL", default=None, help="Portal API base URL")
@click.option("--token", envvar="MST_TOKEN", default=None, help="JWT token (skips login)")
@click.option("--username", "-u", envvar="MST_USERNAME", default=None, help="Username")
@click.option("--password", "-p", envvar="MST_PASSWORD", default=None, help="Password")
@click.option("--watch", is_flag=True, help="Poll every 10 s until all jobs finish")
@click.option("--interval", type=int, default=10, show_default=True, help="Poll interval in seconds")
def status(
    video_ids: tuple[str, ...],
    api_url: str | None,
    token: str | None,
    username: str | None,
    password: str | None,
    watch: bool,
    interval: int,
) -> None:
    """Check auto-processing status for VIDEO_IDS.

    \b
    Examples:
      mst-ingest status abc123
      mst-ingest status abc123 def456 --watch
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
                results[vid] = {"status": "error", "error": str(exc)}
        return results

    def display(results: dict[str, dict]) -> None:
        for vid, s in results.items():
            st = s.get("status", "unknown")
            colour = {
                "ready": "green",
                "processing": "cyan",
                "queued": "yellow",
                "failed": "red",
                "error": "red",
            }.get(st, "white")
            extra = ""
            if s.get("error"):
                extra = f" — {s['error']}"
            elif s.get("progress") is not None:
                extra = f" ({s['progress']}%)"
            ui.console.print(f"  [{colour}]{vid}[/{colour}]  [{colour}]{st}[/{colour}]{extra}")

    if not watch:
        display(poll_once())
        return

    while True:
        results = poll_once()
        ui.console.clear()
        display(results)
        pending = [v for v, s in results.items() if s.get("status") in _RUNNING]
        if not pending:
            break
        ui.console.print(f"\n  [dim]Refreshing in {interval}s — Ctrl-C to stop[/dim]")
        time.sleep(interval)
