# mst-ingest

CLI tool for ingesting videos into the MST AI Portal.

## Install

```bash
pip install -e ./cli          # from repo root
# or
pip install requests rich requests-toolbelt click
```

## Quick start

```bash
# Generate a template JSON
mst-ingest template > video.json
mst-ingest template --batch > videos.json

# Validate without uploading
mst-ingest validate video.json

# Single video via flags
mst-ingest run \
  --title "Session 1 — Introduction" \
  --video-file /path/to/session1.mp4 \
  --category "AI Foundations"

# Batch from file
mst-ingest run --file videos.json

# Check processing status
mst-ingest status <video-id>
mst-ingest status <id1> <id2> --watch
```

## Authentication

Credentials are resolved in this order:

| Source | Variable / flag |
|--------|-----------------|
| CLI flag | `--token` / `--username` + `--password` |
| Environment | `MST_TOKEN` or `MST_USERNAME` + `MST_PASSWORD` |
| Config file | `~/.mst-ingest.json` (written after first successful login) |
| Interactive | prompted at runtime |

API URL defaults to `http://localhost:8000`; override with `MST_API_URL` or `--api-url`.

## JSON file format

**Single video:**
```json
{
  "title": "My Video Title",
  "slug": "",
  "description": "A brief description.",
  "category": "AI Foundations",
  "course_id": null,
  "sort_order": 0,
  "video_file": "/absolute/path/to/video.mp4",
  "auto_process": true
}
```

**Batch (list of objects):**
```json
[
  { "title": "Session 1", "video_file": "/videos/s1.mp4", "category": "AI Foundations", "sort_order": 0 },
  { "title": "Session 2", "video_file": "/videos/s2.mp4", "category": "AI Foundations", "sort_order": 1 }
]
```

## Pipeline

Each video goes through five steps:

```
[1/5] Validate inputs
[2/5] Authenticate
[3/5] Create video record (draft)
[4/5] Upload file (progress bar)
[5/5] Trigger auto-process
```

Videos are **never published automatically** — log in to the portal to review transcripts, thumbnails, and metadata before publishing.

## Commands

| Command | Description |
|---------|-------------|
| `run` | Full ingest pipeline |
| `validate` | Offline validation only |
| `status` | Check auto-processing status |
| `template` | Print a starter JSON template |

Run `mst-ingest <command> --help` for full option reference.
