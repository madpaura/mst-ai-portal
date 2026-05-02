#!/usr/bin/env python3
"""
MST AI Portal — Folder Watcher
────────────────────────────────────────────────────────────────────────────────
Watches a Samba-exposed directory tree and auto-ingests videos via the portal.

Layout expected under watch_root:
    Category Name/        ← immediate subdirectory  = course category
        lecture-01.mp4    ← video file              = auto-ingested
        .ingest-log.csv   ← auto-created status log (never deleted)

Usage:
    python watch.py                         # uses watcher.json in repo root
    python watch.py --config /path/to.json
    python watch.py --scan                  # one-shot scan (for cron)

Install extra dep:
    pip install watchdog
"""
from __future__ import annotations

import argparse
import csv
import json
import logging
import os
import signal
import sys
import time
from datetime import datetime, timezone
from logging.handlers import RotatingFileHandler
from pathlib import Path

# ── path setup so cli/lib/ is importable ──────────────────────────────────────
_REPO = Path(__file__).parent.resolve()
sys.path.insert(0, str(_REPO))

from cli.lib.api import APIClient, APIError
from cli.lib.auth import _load_config as _load_auth_config
from cli.lib.validator import slugify

# ── constants ─────────────────────────────────────────────────────────────────
LOG_FILE_NAME  = ".ingest-log.csv"
LOG_FIELDS     = ["filename", "title", "slug", "category", "size_mb",
                  "status", "video_id", "ingested_at", "error"]
ALLOWED_EXT    = {".mp4", ".webm"}
MAX_SIZE_MB    = 100
STABILIZE_S    = 15       # seconds file must be unchanged before ingestion
SCAN_INTERVAL  = 30       # polling interval for "always" mode fallback

# Status values used in the CSV
S_PENDING      = "pending"
S_SKIPPED      = "skipped"
S_UPLOADING    = "uploading"
S_UPLOADED     = "uploaded"
S_FAILED       = "failed"
S_DONE         = "done"     # uploaded + auto-process triggered

# ── logging ───────────────────────────────────────────────────────────────────
log = logging.getLogger("watcher")


def _setup_logging(log_path: str | None) -> None:
    fmt = logging.Formatter("%(asctime)s  %(levelname)-7s  %(message)s",
                            datefmt="%Y-%m-%d %H:%M:%S")
    log.setLevel(logging.DEBUG)
    sh = logging.StreamHandler(sys.stdout)
    sh.setFormatter(fmt)
    log.addHandler(sh)
    if log_path:
        fh = RotatingFileHandler(log_path, maxBytes=5_000_000, backupCount=3)
        fh.setFormatter(fmt)
        log.addHandler(fh)


# ── config ────────────────────────────────────────────────────────────────────
def _load_config(path: str) -> dict:
    p = Path(path)
    if not p.exists():
        log.warning("Config file not found: %s — using defaults", path)
        return {}
    return json.loads(p.read_text())


def _resolve_client(cfg: dict) -> APIClient:
    """Build an authenticated APIClient from config / cached token."""
    url = cfg.get("api_url") or os.environ.get("MST_API_URL") or "http://localhost:9800"
    tok = (cfg.get("token")
           or os.environ.get("MST_TOKEN")
           or _load_auth_config().get("token"))

    if not tok:
        usr = cfg.get("username") or os.environ.get("MST_USERNAME")
        pwd = cfg.get("password") or os.environ.get("MST_PASSWORD")
        if not (usr and pwd):
            raise RuntimeError(
                "No credentials available. Set token/username/password in watcher.json "
                "or run: mst-ingest login"
            )
        tok = APIClient.login(url, usr, pwd)

    return APIClient(url, tok)


# ── per-folder CSV log ────────────────────────────────────────────────────────
def _log_path(folder: Path) -> Path:
    return folder / LOG_FILE_NAME


def _read_log(folder: Path) -> dict[str, dict]:
    """Return {filename: row} from the folder's CSV log."""
    p = _log_path(folder)
    if not p.exists():
        return {}
    with p.open(newline="") as f:
        return {row["filename"]: row for row in csv.DictReader(f)}


def _write_log(folder: Path, rows: dict[str, dict]) -> None:
    """Overwrite the folder's CSV log with the current rows dict."""
    p = _log_path(folder)
    with p.open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=LOG_FIELDS, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows.values())


def _upsert_log(folder: Path, filename: str, **fields) -> None:
    """Update a single row in the CSV log (creates file if needed)."""
    rows = _read_log(folder)
    row  = rows.get(filename, {"filename": filename})
    row.update(fields)
    rows[filename] = row
    _write_log(folder, rows)


# ── validation ────────────────────────────────────────────────────────────────
def _validate_file(path: Path, max_mb: int, allowed_ext: set[str]) -> str | None:
    """Return an error string, or None if the file is acceptable."""
    if path.suffix.lower() not in allowed_ext:
        return f"extension {path.suffix!r} not allowed (accepted: {', '.join(sorted(allowed_ext))})"
    size_mb = path.stat().st_size / 1_048_576
    if size_mb > max_mb:
        return f"file too large ({size_mb:.1f} MB > {max_mb} MB limit)"
    if path.stat().st_size == 0:
        return "file is empty"
    return None


def _is_stable(path: Path, wait_s: int) -> bool:
    """Return True once the file size hasn't changed for wait_s seconds."""
    try:
        size_before = path.stat().st_size
        time.sleep(wait_s)
        return path.exists() and path.stat().st_size == size_before
    except OSError:
        return False


# ── ingestion ─────────────────────────────────────────────────────────────────
def _title_from_filename(name: str) -> str:
    """'my-video-01.mp4' → 'My Video 01'"""
    stem = Path(name).stem
    return stem.replace("-", " ").replace("_", " ").title()


def _ingest_file(path: Path, category: str, client: APIClient, cfg: dict) -> None:
    """Run the full ingest pipeline for a single video file."""
    folder   = path.parent
    filename = path.name
    title    = _title_from_filename(filename)
    slug_val = slugify(title)
    size_mb  = round(path.stat().st_size / 1_048_576, 2)

    log.info("[%s] %s — starting ingest (%.1f MB)", category, filename, size_mb)

    _upsert_log(folder, filename, title=title, slug=slug_val, category=category,
                size_mb=size_mb, status=S_UPLOADING, ingested_at=_now(), error="")

    # ── create record ─────────────────────────────────────────────────────────
    try:
        video = client.create_video({
            "title":       title,
            "slug":        slug_val,
            "description": "",
            "category":    category,
            "course_id":   None,
            "sort_order":  0,
            "status":      "draft",
        })
    except APIError as exc:
        log.error("[%s] %s — create record failed: %s", category, filename, exc)
        _upsert_log(folder, filename, status=S_FAILED, error=str(exc))
        return

    video_id = video["id"]

    # ── upload ────────────────────────────────────────────────────────────────
    try:
        client.upload_video(video_id, path)
    except APIError as exc:
        log.error("[%s] %s — upload failed: %s", category, filename, exc)
        _upsert_log(folder, filename, video_id=video_id, status=S_FAILED, error=str(exc))
        return

    log.info("[%s] %s — uploaded (id=%s)", category, filename, video_id)

    # ── transcode ─────────────────────────────────────────────────────────────
    if cfg.get("transcode", False):
        try:
            client.trigger_transcode(video_id)
            log.info("[%s] %s — transcode queued", category, filename)
        except APIError as exc:
            log.warning("[%s] %s — transcode trigger failed: %s", category, filename, exc)

    # ── auto-process ──────────────────────────────────────────────────────────
    if cfg.get("auto_process", True):
        try:
            client.trigger_auto_process(video_id)
            log.info("[%s] %s — auto-process triggered", category, filename)
        except APIError as exc:
            log.warning("[%s] %s — auto-process trigger failed: %s", category, filename, exc)

    _upsert_log(folder, filename, video_id=video_id, status=S_DONE,
                ingested_at=_now(), error="")
    log.info("[%s] %s — done ✓", category, filename)


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# ── scan one folder ───────────────────────────────────────────────────────────
def _scan_folder(folder: Path, client: APIClient, cfg: dict) -> None:
    """Check all video files in folder and ingest any that are new."""
    category   = folder.name
    allowed    = set(cfg.get("allowed_ext", list(ALLOWED_EXT)))
    max_mb     = cfg.get("max_size_mb", MAX_SIZE_MB)
    stabilize  = cfg.get("stabilize_s", STABILIZE_S)
    existing   = _read_log(folder)

    for path in sorted(folder.iterdir()):
        if not path.is_file():
            continue
        if path.name.startswith("."):
            continue
        if path.suffix.lower() not in allowed:
            continue

        filename = path.name
        prev     = existing.get(filename, {})
        if prev.get("status") in (S_DONE, S_UPLOADED, S_SKIPPED):
            continue                           # already handled — never re-process

        # Wait for the file to finish being written (Samba partial-upload guard)
        log.debug("[%s] %s — waiting %ds for stability", category, filename, stabilize)
        if not _is_stable(path, stabilize):
            log.warning("[%s] %s — file still changing, deferring", category, filename)
            continue

        # Validate
        err = _validate_file(path, max_mb, allowed)
        if err:
            log.warning("[%s] %s — skipped: %s", category, filename, err)
            _upsert_log(folder, filename, title=_title_from_filename(filename),
                        slug=slugify(_title_from_filename(filename)),
                        category=category,
                        size_mb=round(path.stat().st_size / 1_048_576, 2),
                        status=S_SKIPPED, ingested_at=_now(), error=err)
            continue

        _ingest_file(path, category, client, cfg)


# ── scan entire watch root ────────────────────────────────────────────────────
def _scan_root(root: Path, client: APIClient, cfg: dict) -> None:
    """Walk immediate subdirectories of root and scan each as a category."""
    found = [d for d in sorted(root.iterdir()) if d.is_dir() and not d.name.startswith(".")]
    if not found:
        log.info("No category folders found under %s", root)
        return
    for folder in found:
        log.info("Scanning category: %s", folder.name)
        try:
            _scan_folder(folder, client, cfg)
        except Exception as exc:
            log.error("Error scanning %s: %s", folder.name, exc, exc_info=True)


# ── watchdog event handler ────────────────────────────────────────────────────
def _start_watchdog(root: Path, client: APIClient, cfg: dict) -> None:
    try:
        from watchdog.observers import Observer
        from watchdog.events import FileSystemEventHandler
    except ImportError:
        log.error("watchdog not installed — run: pip install watchdog")
        sys.exit(1)

    class _Handler(FileSystemEventHandler):
        def on_created(self, event):
            if event.is_directory:
                log.info("New category folder detected: %s", Path(event.src_path).name)
                return
            self._handle(Path(event.src_path))

        def on_moved(self, event):
            # Samba often writes to a temp name then renames
            if not event.is_directory:
                self._handle(Path(event.dest_path))

        def _handle(self, path: Path):
            if path.name.startswith(".") or path.suffix.lower() not in set(cfg.get("allowed_ext", list(ALLOWED_EXT))):
                return
            folder = path.parent
            # Only process files one level deep (category/video.mp4)
            if folder.parent != root:
                return
            category = folder.name
            stabilize = cfg.get("stabilize_s", STABILIZE_S)
            log.info("[%s] Detected new file: %s", category, path.name)
            if not _is_stable(path, stabilize):
                log.warning("[%s] %s — file still changing after %ds, skipping", category, path.name, stabilize)
                return
            err = _validate_file(path, cfg.get("max_size_mb", MAX_SIZE_MB), set(cfg.get("allowed_ext", list(ALLOWED_EXT))))
            if err:
                log.warning("[%s] %s — skipped: %s", category, path.name, err)
                _upsert_log(folder, path.name,
                            title=_title_from_filename(path.name),
                            slug=slugify(_title_from_filename(path.name)),
                            category=category,
                            size_mb=round(path.stat().st_size / 1_048_576, 2),
                            status=S_SKIPPED, ingested_at=_now(), error=err)
                return
            existing = _read_log(folder)
            if existing.get(path.name, {}).get("status") in (S_DONE, S_UPLOADED, S_SKIPPED):
                return
            _ingest_file(path, category, client, cfg)

    observer = Observer()
    observer.schedule(_Handler(), str(root), recursive=True)
    observer.start()
    log.info("Watchdog started on %s", root)
    return observer


# ── scheduled daily runner ────────────────────────────────────────────────────
def _parse_hhmm(s: str) -> tuple[int, int] | None:
    try:
        parts = s.split(":")
        return int(parts[0]), int(parts[1])
    except Exception:
        return None


def _seconds_until(h: int, m: int) -> float:
    now = datetime.now()
    target = now.replace(hour=h, minute=m, second=0, microsecond=0)
    if target <= now:
        target = target.replace(day=target.day + 1)
    return (target - now).total_seconds()


# ── main ──────────────────────────────────────────────────────────────────────
def main() -> None:
    parser = argparse.ArgumentParser(
        description="MST AI Portal — Folder Watcher",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("--config", default=str(_REPO / "watcher.json"),
                        help="Path to watcher.json config file (default: watcher.json)")
    parser.add_argument("--scan", action="store_true",
                        help="Scan once and exit (overrides mode in config; for cron)")
    args = parser.parse_args()

    cfg = _load_config(args.config)

    _setup_logging(cfg.get("log_file") or str(_REPO / "watch.log"))

    log.info("MST AI Portal — Folder Watcher starting")

    root = Path(cfg.get("watch_root", ".")).expanduser().resolve()
    if not root.exists():
        log.error("watch_root does not exist: %s", root)
        sys.exit(1)

    log.info("Watch root : %s", root)

    try:
        client = _resolve_client(cfg)
    except Exception as exc:
        log.error("Auth failed: %s", exc)
        sys.exit(1)

    mode = "scan" if args.scan else cfg.get("mode", "always")

    # ── one-shot scan ──────────────────────────────────────────────────────────
    if mode == "scan":
        log.info("Mode: scan (one-shot)")
        _scan_root(root, client, cfg)
        log.info("Scan complete.")
        return

    # ── daily scheduled ────────────────────────────────────────────────────────
    scheduled = _parse_hhmm(mode) if mode not in ("always",) else None
    if scheduled:
        h, m = scheduled
        log.info("Mode: scheduled at %02d:%02d daily", h, m)
        def _shutdown(sig, frame):
            log.info("Shutting down.")
            sys.exit(0)
        signal.signal(signal.SIGINT, _shutdown)
        signal.signal(signal.SIGTERM, _shutdown)
        while True:
            wait = _seconds_until(h, m)
            log.info("Next scan in %.0f s (at %02d:%02d)", wait, h, m)
            time.sleep(wait)
            _scan_root(root, client, cfg)
        return

    # ── always (watchdog daemon) ───────────────────────────────────────────────
    log.info("Mode: always (watchdog daemon)")

    # Initial scan on startup to catch anything added while the watcher was down
    log.info("Running initial scan...")
    _scan_root(root, client, cfg)

    observer = _start_watchdog(root, client, cfg)

    def _shutdown(sig, frame):
        log.info("Shutting down watchdog...")
        observer.stop()
        observer.join()
        log.info("Stopped.")
        sys.exit(0)

    signal.signal(signal.SIGINT, _shutdown)
    signal.signal(signal.SIGTERM, _shutdown)

    # Keep-alive loop: also re-auth periodically (token may expire)
    try:
        while observer.is_alive():
            time.sleep(SCAN_INTERVAL)
    except Exception:
        observer.stop()
        observer.join()


if __name__ == "__main__":
    main()
