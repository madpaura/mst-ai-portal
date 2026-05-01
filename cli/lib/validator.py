"""Input validation rules for ingest entries."""
from __future__ import annotations

import re
from pathlib import Path

VIDEO_EXTENSIONS = {".mp4", ".mov", ".avi", ".mkv", ".webm", ".m4v", ".ts", ".mts"}
SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]*[a-z0-9]$")


def validate_entry(entry: dict) -> list[str]:
    """Return a list of human-readable error strings (empty = valid)."""
    errors: list[str] = []

    if not (entry.get("title") or "").strip():
        errors.append("`title` is required and cannot be empty")

    if not (entry.get("category") or "").strip():
        errors.append("`category` is required and cannot be empty")

    vf = (entry.get("video_file") or "").strip()
    if not vf:
        errors.append("`video_file` path is required")
    else:
        p = Path(vf)
        if not p.exists():
            errors.append(f"`video_file` not found: {vf}")
        elif not p.is_file():
            errors.append(f"`video_file` is not a file: {vf}")
        elif p.suffix.lower() not in VIDEO_EXTENSIONS:
            errors.append(
                f"`video_file` must be a video ({', '.join(sorted(VIDEO_EXTENSIONS))})"
                f", got: {p.suffix!r}"
            )

    slug = (entry.get("slug") or "").strip()
    if slug and len(slug) >= 2 and not SLUG_RE.match(slug):
        errors.append(
            "`slug` must be lowercase alphanumeric with hyphens only, e.g. \"my-video\""
        )

    sort_order = entry.get("sort_order", 0)
    if not isinstance(sort_order, int) or sort_order < 0:
        errors.append("`sort_order` must be a non-negative integer")

    return errors


def slugify(title: str) -> str:
    """Convert a title to a URL-safe slug."""
    s = title.lower().strip()
    s = re.sub(r"[^a-z0-9\s-]", "", s)
    s = re.sub(r"[\s_]+", "-", s)
    s = re.sub(r"-+", "-", s).strip("-")
    return s or "video"
