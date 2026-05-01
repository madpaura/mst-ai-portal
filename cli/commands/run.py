"""Main ingest pipeline: validate → auth → create → upload → auto-process."""
from __future__ import annotations

import json
import sys
from pathlib import Path

import click

from ..lib import progress as ui
from ..lib.api import APIClient, APIError
from ..lib.auth import resolve
from ..lib.validator import slugify, validate_entry

_STEPS = 5


def _ingest_one(client: APIClient, entry: dict, idx: int, total: int) -> dict:
    """Run the full pipeline for a single entry. Returns the final video record."""
    title = entry.get("title", f"Video {idx + 1}")
    video_path = Path(entry["video_file"])
    prefix = f"[{idx + 1}/{total}]" if total > 1 else ""

    # ── 3/5  Create record ─────────────────────────────────────────────────
    payload = {
        "title": entry["title"],
        "slug": entry.get("slug") or slugify(entry["title"]),
        "description": entry.get("description", ""),
        "category": entry["category"],
        "course_id": entry.get("course_id"),
        "sort_order": entry.get("sort_order", 0),
        "status": "draft",
    }
    ui.step(3, _STEPS, f"{prefix} Creating record for {title!r}")
    try:
        video = client.create_video(payload)
    except APIError as exc:
        ui.error(f"Failed to create record: {exc}")
        raise

    video_id = video["id"]

    # ── 4/5  Upload file ───────────────────────────────────────────────────
    file_size = video_path.stat().st_size
    ui.step(4, _STEPS, f"{prefix} Uploading {video_path.name} ({file_size // 1_048_576} MB)")

    with ui.make_upload_progress() as prog:
        task = prog.add_task(video_path.name, total=file_size)

        def _on_progress(monitor):
            prog.update(task, completed=monitor.bytes_read)

        try:
            client.upload_video(video_id, video_path, on_progress=_on_progress)
        except APIError as exc:
            ui.error(f"Upload failed: {exc}")
            raise

    # ── 5/5  Trigger auto-process ──────────────────────────────────────────
    if entry.get("auto_process", True):
        ui.step(5, _STEPS, f"{prefix} Triggering auto-process")
        try:
            client.trigger_auto_process(video_id)
        except APIError as exc:
            ui.warn(f"Auto-process trigger failed (video was uploaded): {exc}")
    else:
        ui.step(5, _STEPS, f"{prefix} Skipping auto-process (auto_process=false)", ok=False)

    return client.get_video(video_id)


@click.command("run")
@click.option("--file", "-f", "json_file", type=click.Path(exists=True, dir_okay=False),
              default=None, help="JSON file (single object or list)")
@click.option("--title", default="", help="Video title")
@click.option("--video-file", "video_file", default="", help="Path to video file")
@click.option("--category", default="", help="Category name")
@click.option("--description", default="", help="Short description")
@click.option("--slug", default="", help="URL slug (auto-generated if omitted)")
@click.option("--sort-order", "sort_order", type=int, default=0)
@click.option("--course-id", "course_id", default=None, help="Course UUID to attach to")
@click.option("--no-auto-process", "no_auto_process", is_flag=True,
              help="Skip auto-processing after upload")
@click.option("--api-url", envvar="MST_API_URL", default=None, hidden=True)
@click.option("--token", envvar="MST_TOKEN", default=None, hidden=True)
@click.option("--username", "-u", envvar="MST_USERNAME", default=None, hidden=True)
@click.option("--password", "-p", envvar="MST_PASSWORD", default=None, hidden=True)
def run(
    json_file: str | None,
    title: str,
    video_file: str,
    category: str,
    description: str,
    slug: str,
    sort_order: int,
    course_id: str | None,
    no_auto_process: bool,
    api_url: str | None,
    token: str | None,
    username: str | None,
    password: str | None,
) -> None:
    """Ingest one or more videos into the MST AI portal.

    \b
    Single video (flags):
      mst-ingest run --title "Session 1" --video-file /path/video.mp4 --category "AI Foundations"

    \b
    From JSON file:
      mst-ingest run --file videos.json

    Videos are created as drafts and never published automatically.
    """
    # ── Build entry list ───────────────────────────────────────────────────
    if json_file:
        raw = Path(json_file).read_text()
        try:
            data = json.loads(raw)
        except json.JSONDecodeError as exc:
            ui.error(f"Invalid JSON: {exc}")
            sys.exit(1)
        entries = data if isinstance(data, list) else [data]
    else:
        if not (title and video_file and category):
            ui.error("--title, --video-file, and --category are required (or use --file)")
            sys.exit(1)
        entries = [{
            "title": title,
            "video_file": video_file,
            "category": category,
            "description": description,
            "slug": slug,
            "sort_order": sort_order,
            "course_id": course_id,
            "auto_process": not no_auto_process,
        }]

    ui.header()

    # ── 1/5  Validate ──────────────────────────────────────────────────────
    ui.step(1, _STEPS, f"Validating {len(entries)} entr{'y' if len(entries) == 1 else 'ies'}")
    all_valid = True
    for i, entry in enumerate(entries):
        errs = validate_entry(entry)
        if errs:
            all_valid = False
            label = entry.get("title") or f"Entry {i + 1}"
            ui.error(f"  {label}:")
            for e in errs:
                ui.error(f"    {e}")

    if not all_valid:
        ui.error("Fix the errors above and try again.")
        sys.exit(1)

    # ── 2/5  Authenticate ──────────────────────────────────────────────────
    ui.step(2, _STEPS, "Authenticating")
    try:
        url, tok = resolve(
            api_url=api_url,
            token=token,
            username=username,
            password=password,
        )
    except APIError as exc:
        ui.error(str(exc))
        sys.exit(1)

    if not APIClient.health_check(url):
        ui.error(f"API not reachable at {url}")
        sys.exit(1)

    client = APIClient(url, tok)

    # ── 3-5  Per-video pipeline ────────────────────────────────────────────
    completed: list[dict] = []
    failed = 0
    for i, entry in enumerate(entries):
        try:
            rec = _ingest_one(client, entry, i, len(entries))
            completed.append({
                "title": rec.get("title", ""),
                "id": rec.get("id", ""),
                "slug": rec.get("slug", ""),
                "status": rec.get("status", ""),
            })
        except APIError:
            failed += 1

    if completed:
        ui.summary_panel(completed)

    if failed:
        ui.error(f"{failed} video(s) failed — check errors above.")
        sys.exit(1)
