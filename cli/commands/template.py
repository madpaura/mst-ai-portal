"""Print a JSON template the user can edit and pass to `mst-ingest run --file`."""
import json
import click

_ENTRY = {
    "title": "My Video Title",
    "slug": "",
    "description": "A brief description of this video session.",
    "category": "AI Foundations",
    "course_id": None,
    "sort_order": 0,
    "video_file": "/absolute/path/to/video.mp4",
    "transcode": False,
    "auto_process": True,
}


@click.command("template")
@click.option("--batch", is_flag=True, help="Output a batch list with 3 example entries")
def template(batch: bool) -> None:
    """Print a JSON template for use with `mst-ingest run --file`.

    \b
    Single video:
      mst-ingest template > video.json

    \b
    Batch:
      mst-ingest template --batch > videos.json
    """
    if batch:
        data = [
            {**_ENTRY, "title": "Session 1 — Introduction", "video_file": "/videos/s1.mp4", "sort_order": 0},
            {**_ENTRY, "title": "Session 2 — Deep Dive",    "video_file": "/videos/s2.mp4", "sort_order": 1},
            {**_ENTRY, "title": "Session 3 — Wrap-up",      "video_file": "/videos/s3.mp4", "sort_order": 2},
        ]
    else:
        data = dict(_ENTRY)

    click.echo(json.dumps(data, indent=2))
