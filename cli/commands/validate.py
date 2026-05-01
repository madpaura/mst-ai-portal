"""Offline validation command — checks entries without touching the API."""
from __future__ import annotations

import json
import sys
from pathlib import Path

import click

from ..lib import progress as ui
from ..lib.validator import validate_entry


@click.command("validate")
@click.argument("file", required=False, type=click.Path(exists=True, dir_okay=False))
@click.option("--title", default="", help="Video title")
@click.option("--video-file", "video_file", default="", help="Path to video file")
@click.option("--category", default="", help="Category name")
@click.option("--sort-order", "sort_order", type=int, default=0)
def validate(
    file: str | None,
    title: str,
    video_file: str,
    category: str,
    sort_order: int,
) -> None:
    """Validate a video entry or JSON file without uploading.

    \b
    Single video:
      mst-ingest validate --title "My Video" --video-file /path/to/video.mp4 --category AI

    \b
    From file:
      mst-ingest validate videos.json
    """
    if file:
        raw = Path(file).read_text()
        try:
            data = json.loads(raw)
        except json.JSONDecodeError as e:
            ui.error(f"Invalid JSON: {e}")
            sys.exit(1)
        entries = data if isinstance(data, list) else [data]
    else:
        entries = [{"title": title, "video_file": video_file, "category": category, "sort_order": sort_order}]

    all_ok = True
    for i, entry in enumerate(entries):
        label = entry.get("title") or f"Entry {i + 1}"
        errs = validate_entry(entry)
        if errs:
            all_ok = False
            ui.error(f"[bold]{label}[/bold]")
            for e in errs:
                ui.error(f"  {e}")
        else:
            ui.step(i + 1, len(entries), f"[green]{label}[/green] — OK")

    if not all_ok:
        sys.exit(1)
    else:
        ui.console.print("\n  [green]All entries are valid.[/green]")
