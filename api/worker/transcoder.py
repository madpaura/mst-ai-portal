"""
FFmpeg Transcoding Worker
Polls PostgreSQL for pending transcode jobs and processes them.

Run standalone: python -m worker.transcoder
"""
import asyncio
import json
import os
import shutil
import signal
import subprocess
import sys
import threading
import time
from typing import Optional

import asyncpg
from loguru import logger as log

log.remove()
log.add(
    sys.stderr,
    format="<green>{time:HH:mm:ss}</green> | <level>{level:<7}</level> | {message}",
    level=os.environ.get("LOG_LEVEL", "INFO").upper(),
    colorize=True,
)

# Allow running as standalone module
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from config import settings
from worker.gpu_detect import get_encode_args, get_hwaccel_args, get_gpu_info
from video.schemas import EXPORT_QUALITY_HEIGHTS

# ── Graceful shutdown state ───────────────────────────────────────────────────
_shutdown = threading.Event()
_active_proc: Optional[subprocess.Popen] = None
_current_job_id: Optional[int] = None

# Editor export/render jobs (issue #260) get their own active-process handle
# so a shutdown mid-render terminates the right ffmpeg process without
# disturbing a concurrently-tracked transcode job (the worker only ever runs
# one of the two at a time, but keeping them separate avoids any ambiguity).
_active_render_proc: Optional["asyncio.subprocess.Process"] = None
_current_render_job_id: Optional[int] = None


def _handle_shutdown(signum, frame):
    log.info(f"Signal {signum} received — initiating graceful shutdown")
    _shutdown.set()
    if _active_proc and _active_proc.poll() is None:
        log.info("Terminating active FFmpeg process")
        _active_proc.terminate()
    if _active_render_proc and _active_render_proc.returncode is None:
        log.info("Terminating active FFmpeg render process")
        try:
            _active_render_proc.terminate()
        except ProcessLookupError:
            pass


signal.signal(signal.SIGTERM, _handle_shutdown)
signal.signal(signal.SIGINT, _handle_shutdown)


QUALITY_PROFILES = {
    "360p": {"scale": "360", "crf_default": 28, "audio_bitrate": "96k"},
    "720p": {"scale": "720", "crf_default": 23, "audio_bitrate": "128k"},
    "1080p": {"scale": "1080", "crf_default": 22, "audio_bitrate": "192k"},
}


async def claim_job(pool: asyncpg.Pool):
    """Atomically claim a pending job using SKIP LOCKED."""
    return await pool.fetchrow(
        """
        UPDATE transcode_jobs
        SET status = 'processing', started_at = now(), attempts = attempts + 1
        WHERE id = (
            SELECT id FROM transcode_jobs
            WHERE status = 'pending' AND attempts < max_attempts
            ORDER BY created_at ASC
            LIMIT 1
            FOR UPDATE SKIP LOCKED
        )
        RETURNING *
        """
    )


async def get_quality_settings(pool: asyncpg.Pool, video_id):
    """Get enabled quality tiers for a video."""
    rows = await pool.fetch(
        "SELECT * FROM video_quality_settings WHERE video_id = $1 AND enabled = true",
        video_id,
    )
    if not rows:
        return [
            {"quality": "360p", "crf": 28},
            {"quality": "720p", "crf": 23},
            {"quality": "1080p", "crf": 22},
        ]
    return [{"quality": r["quality"], "crf": r["crf"]} for r in rows]


def run_ffmpeg(input_path: str, output_dir: str, quality: str, crf: int) -> bool:
    """Run FFmpeg to transcode a single quality tier. Uses GPU (NVENC) if available."""
    global _active_proc
    profile = QUALITY_PROFILES[quality]
    hls_dir = os.path.join(output_dir, quality)
    os.makedirs(hls_dir, exist_ok=True)

    gpu = get_gpu_info()
    cmd = [
        settings.FFMPEG_PATH, "-y",
        *get_hwaccel_args(),
        "-i", input_path,
        "-vf", f"scale=-2:{profile['scale']}",
        *get_encode_args(crf=crf),
        "-c:a", "aac", "-b:a", profile["audio_bitrate"],
        "-hls_time", "6", "-hls_playlist_type", "vod",
        "-hls_segment_filename", os.path.join(hls_dir, "seg_%03d.ts"),
        os.path.join(hls_dir, "index.m3u8"),
    ]

    backend = "GPU" if gpu["gpu_available"] else "CPU"
    log.info(f"Transcoding {quality} (CRF={crf}) [{backend}]")
    start = time.time()
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    _active_proc = proc
    try:
        _, stderr = proc.communicate(timeout=settings.FFMPEG_TIMEOUT)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait()
        elapsed = time.time() - start
        log.error(f"FFmpeg timed out after {elapsed:.0f}s for quality={quality}")
        return False
    finally:
        _active_proc = None

    elapsed = time.time() - start
    if proc.returncode != 0:
        log.error(f"FFmpeg error {quality} ({elapsed:.0f}s): {stderr.decode(errors='replace')[-500:]}")
        return False
    log.info(f"Transcoding {quality} done in {elapsed:.0f}s [{backend}]")
    return True


def generate_thumbnail(input_path: str, output_path: str, timestamp: int = 30):
    """Generate a thumbnail from the video at ~frame 30 (1s at 30fps)."""
    cmd = [
        settings.FFMPEG_PATH, "-y", "-i", input_path,
        "-ss", str(timestamp), "-vframes", "1", "-q:v", "2",
        output_path,
    ]
    try:
        subprocess.run(cmd, capture_output=True, timeout=120)
    except subprocess.TimeoutExpired:
        log.warning(f"Thumbnail generation timed out for {input_path}")


def generate_master_manifest(hls_dir: str, qualities: list[dict]):
    """Generate the master.m3u8 adaptive bitrate manifest."""
    bandwidth_map = {"360p": 800000, "720p": 2500000, "1080p": 5000000}
    resolution_map = {"360p": "640x360", "720p": "1280x720", "1080p": "1920x1080"}

    lines = ["#EXTM3U"]
    for q in sorted(qualities, key=lambda x: bandwidth_map.get(x["quality"], 0)):
        qual = q["quality"]
        bw = bandwidth_map.get(qual, 2500000)
        res = resolution_map.get(qual, "1280x720")
        lines.append(f"#EXT-X-STREAM-INF:BANDWIDTH={bw},RESOLUTION={res}")
        lines.append(f"{qual}/index.m3u8")

    manifest_path = os.path.join(hls_dir, "master.m3u8")
    with open(manifest_path, "w") as f:
        f.write("\n".join(lines) + "\n")
    log.info(f"master.m3u8 written with {len(qualities)} quality tier(s)")


def get_duration(input_path: str) -> int | None:
    """Get video duration in seconds using ffprobe."""
    cmd = [
        "ffprobe", "-v", "error", "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1", input_path,
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    except subprocess.TimeoutExpired:
        log.warning(f"ffprobe timed out for {input_path}")
        return None
    if result.returncode == 0 and result.stdout.strip():
        try:
            return int(float(result.stdout.strip()))
        except ValueError:
            pass
    return None


def get_duration_precise(input_path: str) -> float | None:
    """Sub-second duration via ffprobe — used by the editor export pipeline
    where whole-second rounding would visibly clip the last speed/trim
    segment."""
    cmd = [
        "ffprobe", "-v", "error", "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1", input_path,
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    except subprocess.TimeoutExpired:
        log.warning(f"ffprobe timed out for {input_path}")
        return None
    if result.returncode == 0 and result.stdout.strip():
        try:
            return float(result.stdout.strip())
        except ValueError:
            pass
    return None


def get_video_dims(input_path: str) -> tuple[int, int] | None:
    """Return (width, height) of the first video stream via ffprobe."""
    cmd = [
        "ffprobe", "-v", "error", "-select_streams", "v:0",
        "-show_entries", "stream=width,height",
        "-of", "csv=s=x:p=0", input_path,
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    except subprocess.TimeoutExpired:
        log.warning(f"ffprobe timed out for {input_path}")
        return None
    if result.returncode == 0 and result.stdout.strip():
        try:
            w_str, h_str = result.stdout.strip().split("x")
            w, h = int(w_str), int(h_str)
            if w > 0 and h > 0:
                return w, h
        except ValueError:
            pass
    return None


async def process_job(pool: asyncpg.Pool, job):
    """Process a single transcode job."""
    video_id = str(job["video_id"])
    job_id = job["id"]
    log.info(f"Processing job #{job_id} for video {video_id}")

    video_dir = os.path.join(settings.VIDEO_STORAGE_PATH, video_id)
    raw_dir = os.path.join(video_dir, "raw")
    raw_path = os.path.join(raw_dir, "original.mp4")

    if not os.path.exists(raw_path):
        # 1. Check ops.json for the last known source file
        ops_path = os.path.join(raw_dir, "ops.json")
        if os.path.exists(ops_path):
            try:
                import json as _json
                ops = _json.loads(open(ops_path).read())
                if ops:
                    tracked_file = ops[-1].get("file", "original.mp4")
                    tracked_path = os.path.join(raw_dir, tracked_file)
                    if os.path.exists(tracked_path) and tracked_path != raw_path:
                        shutil.copy2(tracked_path, raw_path)
                        log.info(f"Recovered from ops.json: {tracked_file} → original.mp4")
            except Exception as e:
                log.warning(f"ops.json read error: {e}")

        # 2. Fall back to newest .mp4 in the raw directory
        if not os.path.exists(raw_path) and os.path.isdir(raw_dir):
            _exclude = {
                "original_pretrim.mp4", "original_precut.mp4", "original_no_banner.mp4",
                "original_preapply.mp4",
            }
            candidates = [
                f for f in os.listdir(raw_dir)
                if f.endswith(".mp4") and f not in _exclude and ".cut_" not in f and ".trimmed" not in f
            ]
            if candidates:
                candidates.sort(key=lambda f: os.path.getmtime(os.path.join(raw_dir, f)), reverse=True)
                fallback_path = os.path.join(raw_dir, candidates[0])
                shutil.copy2(fallback_path, raw_path)
                log.info(f"Recovered from newest file: {candidates[0]} → original.mp4")

    if not os.path.exists(raw_path):
        error = f"Raw file not found: {raw_path}"
        log.error(f"{error}")
        await pool.execute(
            "UPDATE transcode_jobs SET status = 'failed', error = $1, completed_at = now() WHERE id = $2",
            error, job_id,
        )
        await pool.execute("UPDATE videos SET status = 'error' WHERE id = $1", job["video_id"])
        return

    # Get quality settings
    qualities = await get_quality_settings(pool, job["video_id"])
    hls_dir = os.path.join(video_dir, "hls")
    os.makedirs(hls_dir, exist_ok=True)

    # Transcode each quality tier
    all_ok = True
    for q in qualities:
        ok = run_ffmpeg(raw_path, hls_dir, q["quality"], q["crf"])
        if not ok:
            all_ok = False
            break

    if not all_ok:
        error = "FFmpeg transcode failed for one or more quality tiers"
        if job["attempts"] >= job["max_attempts"]:
            await pool.execute(
                "UPDATE transcode_jobs SET status = 'failed', error = $1, completed_at = now() WHERE id = $2",
                error, job_id,
            )
            await pool.execute("UPDATE videos SET status = 'error' WHERE id = $1", job["video_id"])
        else:
            await pool.execute(
                "UPDATE transcode_jobs SET status = 'pending', error = $1 WHERE id = $2",
                error, job_id,
            )
        return

    # Check if job was cancelled while ffmpeg was running
    current_status = await pool.fetchval("SELECT status FROM transcode_jobs WHERE id = $1", job_id)
    if current_status == "cancelled":
        log.info(f"Job #{job_id} was cancelled — discarding result")
        return

    # Generate master manifest
    generate_master_manifest(hls_dir, qualities)

    # Generate thumbnail
    thumb_path = os.path.join(video_dir, "thumb.jpg")
    generate_thumbnail(raw_path, thumb_path)

    # Get duration
    duration = get_duration(raw_path)

    # Update video record
    hls_path = f"/streams/{video_id}/hls/master.m3u8"
    thumb_url = f"/streams/{video_id}/thumb.jpg"

    await pool.execute(
        "UPDATE videos SET status = 'ready', hls_path = $1, thumbnail = $2, duration_s = $3 WHERE id = $4",
        hls_path, thumb_url, duration, job["video_id"],
    )
    await pool.execute(
        "UPDATE transcode_jobs SET status = 'completed', completed_at = now() WHERE id = $1",
        job_id,
    )
    # Log the transcode operation
    ops_path = os.path.join(raw_dir, "ops.json")
    try:
        from datetime import datetime, timezone
        import json as _json
        ops = _json.loads(open(ops_path).read()) if os.path.exists(ops_path) else []
        ops.append({"op": "transcode", "file": "original.mp4", "ts": datetime.now(timezone.utc).isoformat()})
        ops = ops[-50:]
        with open(ops_path, "w") as _f:
            _json.dump(ops, _f)
    except Exception:
        pass
    log.info(f"Job #{job_id} completed successfully")

    # Auto-mode videos send a "ready to publish" email only once the transcode
    # is done. The auto-processor also calls this after its LLM jobs; whichever
    # worker finishes last wins the atomic claim, so exactly one email is sent.
    try:
        from worker.auto_processor import maybe_notify_owner_ready
        await maybe_notify_owner_ready(pool, job["video_id"])
    except Exception as exc:
        log.error(f"Auto-ready notify after transcode failed | video_id={job['video_id']} error={exc}")


# ── Editor export/render pipeline (issue #260) ─────────────────────────────
#
# Renders the editor's non-destructive EDL (cut/trim/speed + mute) into a
# single downloadable mp4. Approach: normalize the EDL into an ordered list
# of (start, end, factor) segments to *keep* — trim bounds applied, cut
# regions removed, speed regions carved out with everything else at 1.0x —
# then build one ffmpeg filter_complex that trims+setpts each segment and
# concats them. A segment+concat graph was chosen over one giant
# trim/atempo expression per edit: it composes cleanly regardless of how
# cuts and speed regions interleave, and each segment's filters are trivial
# to reason about / log independently.

_EDL_EPS = 0.05  # seconds — clamps/merges within this treated as touching


def _atempo_chain(factor: float) -> list[str]:
    """Decompose a speed factor into a chain of ffmpeg `atempo` filters.

    A single `atempo` instance only accepts [0.5, 2.0]; factors outside that
    (our presets go up to 32x) are reached by chaining multiple stages whose
    product is the requested factor.
    """
    stages: list[float] = []
    f = float(factor)
    while f > 2.0:
        stages.append(2.0)
        f /= 2.0
    while f < 0.5:
        stages.append(0.5)
        f /= 0.5
    stages.append(round(f, 6))
    return [f"atempo={s}" for s in stages]


def normalize_edl(edits: list[dict], duration: float) -> list[tuple[float, float, float]]:
    """Turn a raw edit list into ordered (start, end, factor) keep-segments.

    Order of operations (matches the issue spec): trim bounds first, then
    cut removals within those bounds, then per-region speed carved out of
    whatever remains. Degenerate/overlapping spans are dropped defensively
    (the frontend shouldn't produce them, but a stale/hand-edited draft
    could) rather than raising — a best-effort render beats a hard failure.
    """
    def clamp(t: float) -> float:
        return max(0.0, min(duration, t))

    # 1. Trim — at most one governs the output window; if the draft somehow
    #    has more than one, the first valid one wins and the rest are dropped.
    t0, t1 = 0.0, duration
    for e in edits:
        if e.get("type") != "trim":
            continue
        s, en = clamp(float(e["start_s"])), clamp(float(e["end_s"]))
        if en - s > _EDL_EPS:
            t0, t1 = s, en
            break

    # 2. Cuts — clamp into [t0, t1], drop degenerate, sort + merge overlaps.
    cuts: list[tuple[float, float]] = []
    for e in edits:
        if e.get("type") != "cut":
            continue
        s = max(clamp(float(e["start_s"])), t0)
        en = min(clamp(float(e["end_s"])), t1)
        if en - s > _EDL_EPS:
            cuts.append((s, en))
    cuts.sort()
    merged_cuts: list[list[float]] = []
    for s, en in cuts:
        if merged_cuts and s <= merged_cuts[-1][1] + _EDL_EPS:
            merged_cuts[-1][1] = max(merged_cuts[-1][1], en)
        else:
            merged_cuts.append([s, en])

    # 3. Kept intervals = [t0, t1] minus the merged cuts.
    kept: list[tuple[float, float]] = []
    cursor = t0
    for s, en in merged_cuts:
        if s > cursor + _EDL_EPS:
            kept.append((cursor, s))
        cursor = max(cursor, en)
    if t1 > cursor + _EDL_EPS:
        kept.append((cursor, t1))

    # 4. Speed regions — clamp into [t0, t1], drop degenerate/invalid,
    #    sort, then drop any region overlapping an already-accepted one
    #    (first-in-source-order wins).
    speeds: list[tuple[float, float, float]] = []
    for e in edits:
        if e.get("type") != "speed":
            continue
        factor = e.get("factor")
        if not factor or factor <= 0:
            continue
        s = max(clamp(float(e["start_s"])), t0)
        en = min(clamp(float(e["end_s"])), t1)
        if en - s > _EDL_EPS:
            speeds.append((s, en, float(factor)))
    speeds.sort(key=lambda x: x[0])
    accepted_speeds: list[tuple[float, float, float]] = []
    for s, en, f in speeds:
        if accepted_speeds and s < accepted_speeds[-1][1] - _EDL_EPS:
            continue
        accepted_speeds.append((s, en, f))

    # 5. Split each kept interval by the speed regions overlapping it;
    #    everything not covered by a speed region plays at 1.0x.
    segments: list[tuple[float, float, float]] = []
    for ks, ke in kept:
        cursor = ks
        for s, en, f in accepted_speeds:
            s2, e2 = max(s, ks), min(en, ke)
            if e2 - s2 <= _EDL_EPS:
                continue
            if s2 > cursor + _EDL_EPS:
                segments.append((cursor, s2, 1.0))
            segments.append((s2, e2, f))
            cursor = max(cursor, e2)
        if ke > cursor + _EDL_EPS:
            segments.append((cursor, ke, 1.0))

    return segments


def build_export_filter_complex(
    segments: list[tuple[float, float, float]], muted: bool,
    quality: str, source_height: int,
) -> tuple[str, str, Optional[str], int]:
    """Build the ffmpeg -filter_complex graph for an export render.

    Returns (filter_complex, video_out_label, audio_out_label_or_None,
    target_height) — target_height is echoed back purely for logging.
    """
    parts: list[str] = []
    v_labels: list[str] = []
    a_labels: list[str] = []

    for i, (s, e, f) in enumerate(segments):
        vlab = f"v{i}"
        vfilter = f"[0:v]trim=start={s:.3f}:end={e:.3f},setpts=PTS-STARTPTS"
        if f != 1.0:
            vfilter += f",setpts={1.0 / f:.6f}*PTS"
        vfilter += f"[{vlab}]"
        parts.append(vfilter)
        v_labels.append(vlab)

        if not muted:
            alab = f"a{i}"
            afilter = f"[0:a]atrim=start={s:.3f}:end={e:.3f},asetpts=PTS-STARTPTS"
            if f != 1.0:
                afilter += "," + ",".join(_atempo_chain(f))
            afilter += f"[{alab}]"
            parts.append(afilter)
            a_labels.append(alab)

    n = len(segments)
    if muted:
        parts.append("".join(f"[{v}]" for v in v_labels) + f"concat=n={n}:v=1:a=0[vcat]")
        video_out, audio_out = "vcat", None
    else:
        inputs = "".join(f"[{v}][{a}]" for v, a in zip(v_labels, a_labels))
        parts.append(inputs + f"concat=n={n}:v=1:a=1[vcat][acat]")
        video_out, audio_out = "vcat", "acat"

    # Never upscale beyond the selected target; force even height (scale=-2:h
    # also rounds width to even) — needed both for real downscales and to
    # repair an odd source height that some encoders reject outright.
    src_h_even = source_height - (source_height % 2)
    requested_h = EXPORT_QUALITY_HEIGHTS.get(quality)  # None => 'source'
    target_h = src_h_even if requested_h is None else min(requested_h, src_h_even)
    if target_h != source_height:
        parts.append(f"[{video_out}]scale=-2:{target_h}[vout]")
        video_out = "vout"

    return ";".join(parts), video_out, audio_out, target_h


async def claim_render_job(pool: asyncpg.Pool):
    """Atomically claim a queued editor-export render job."""
    return await pool.fetchrow(
        """
        UPDATE edit_render_jobs
        SET status = 'processing', started_at = now()
        WHERE id = (
            SELECT id FROM edit_render_jobs
            WHERE status = 'queued'
            ORDER BY created_at ASC
            LIMIT 1
            FOR UPDATE SKIP LOCKED
        )
        RETURNING *
        """
    )


async def process_render_job(pool: asyncpg.Pool, job):
    """Render one editor-export job to {video_dir}/exports/edit_<ts>.mp4."""
    global _active_render_proc, _current_render_job_id

    job_id = job["id"]
    video_id = str(job["video_id"])
    log.info(f"Processing render job #{job_id} for video {video_id}")

    async def fail(message: str):
        log.error(f"Render job #{job_id} failed: {message}")
        await pool.execute(
            "UPDATE edit_render_jobs SET status = 'error', error = $1, completed_at = now() WHERE id = $2",
            message, job_id,
        )

    edl = job["edl"]
    if isinstance(edl, str):
        try:
            edl = json.loads(edl)
        except Exception:
            await fail("Corrupt EDL snapshot")
            return
    edits = edl.get("edits", []) or []
    muted = bool(edl.get("muted", False))
    quality = edl.get("quality", "source")
    mode = job["mode"]  # 'download' (issue #260) or 'apply' (issue #261)

    video_dir = os.path.join(settings.VIDEO_STORAGE_PATH, video_id)
    raw_dir = os.path.join(video_dir, "raw")
    raw_path = os.path.join(raw_dir, "original.mp4")
    if not os.path.exists(raw_path):
        await fail("Source file not found on disk")
        return

    duration = await asyncio.to_thread(get_duration_precise, raw_path)
    if not duration or duration <= 0:
        await fail("Could not determine source duration")
        return
    dims = await asyncio.to_thread(get_video_dims, raw_path)
    if not dims:
        await fail("Could not determine source dimensions")
        return
    _source_width, source_height = dims

    segments = normalize_edl(edits, float(duration))
    if not segments:
        await fail("Edit list removes the entire video — nothing to render")
        return

    output_duration = sum((e - s) / f for s, e, f in segments)
    if output_duration <= 0.05:
        await fail("Computed output duration is effectively zero")
        return

    filter_complex, video_out, audio_out, target_h = build_export_filter_complex(
        segments, muted, quality, source_height,
    )

    ts = time.strftime("%Y%m%d_%H%M%S", time.gmtime())
    if mode == "apply":
        # No standalone output file for 'apply' — the render lands in the raw/
        # directory as a scratch file and gets os.replace()'d into
        # original.mp4 once ffmpeg succeeds (see the completion block below).
        output_path = None
        tmp_output = os.path.join(raw_dir, f"original.apply_{ts}.mp4.partial")
    else:
        exports_dir = os.path.join(video_dir, "exports")
        os.makedirs(exports_dir, exist_ok=True)
        output_filename = f"edit_{ts}.mp4"
        output_path = os.path.join(exports_dir, output_filename)
        # Render to a temp path and os.replace() on success — mirrors the
        # tmp-file + atomic-rename pattern used by the filmstrip generator, so
        # a status/download poll can never observe a half-written mp4.
        tmp_output = output_path + ".partial.mp4"

    gpu = get_gpu_info()
    encode_args = get_encode_args(crf=20)
    cmd = [settings.FFMPEG_PATH, "-y", "-i", raw_path, "-filter_complex", filter_complex,
           "-map", f"[{video_out}]"]
    if audio_out:
        cmd += ["-map", f"[{audio_out}]"]
    else:
        cmd += ["-an"]
    cmd += encode_args
    if audio_out:
        cmd += ["-c:a", "aac", "-b:a", "192k"]
    cmd += ["-movflags", "+faststart", "-progress", "pipe:1", "-nostats", tmp_output]

    backend = "GPU" if gpu["gpu_available"] else "CPU"
    log.info(
        f"Render job #{job_id} | segments={len(segments)} quality={quality} "
        f"target_h={target_h} muted={muted} expected_out={output_duration:.1f}s [{backend}]"
    )

    proc = await asyncio.create_subprocess_exec(
        *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
    )
    _active_render_proc = proc
    _current_render_job_id = job_id

    stderr_tail = bytearray()

    async def _drain_stderr():
        assert proc.stderr is not None
        async for chunk in proc.stderr:
            stderr_tail.extend(chunk)
            del stderr_tail[:-4000]  # keep only the last ~4KB for the error message

    stderr_task = asyncio.create_task(_drain_stderr())

    last_pct, last_update = -1, 0.0
    try:
        assert proc.stdout is not None
        while True:
            raw_line = await proc.stdout.readline()
            if not raw_line:
                break
            line = raw_line.decode(errors="replace").strip()
            if not line.startswith("out_time_ms="):
                continue
            try:
                # ffmpeg's -progress field is misleadingly named: the value
                # is microseconds, not milliseconds.
                out_us = int(line.split("=", 1)[1])
            except (ValueError, IndexError):
                continue
            out_s = out_us / 1_000_000.0
            pct = max(0, min(99, int(out_s / output_duration * 100)))
            now = time.monotonic()
            if pct != last_pct and (now - last_update) > 1.0:
                await pool.execute(
                    "UPDATE edit_render_jobs SET progress_pct = $1 WHERE id = $2 AND status = 'processing'",
                    pct, job_id,
                )
                last_pct, last_update = pct, now
        rc = await proc.wait()
        await stderr_task
    finally:
        _active_render_proc = None
        _current_render_job_id = None

    if rc != 0 or not os.path.exists(tmp_output):
        if os.path.exists(tmp_output):
            try:
                os.remove(tmp_output)
            except OSError:
                pass
        err_tail = bytes(stderr_tail).decode(errors="replace")[-500:]
        await fail(f"FFmpeg exited with code {rc}: {err_tail}" if err_tail else f"FFmpeg exited with code {rc}")
        return

    # Check the job wasn't reclaimed/reset out from under us (e.g. a
    # concurrent cleanup or a second export request racing this one) before
    # publishing the file.
    current_status = await pool.fetchval("SELECT status FROM edit_render_jobs WHERE id = $1", job_id)
    if current_status != "processing":
        log.warning(f"Render job #{job_id} no longer 'processing' (now {current_status}) — discarding output")
        try:
            os.remove(tmp_output)
        except OSError:
            pass
        return

    if mode == "apply":
        await _finish_apply_render(pool, job_id, video_id, raw_dir, raw_path, tmp_output)
        return

    os.replace(tmp_output, output_path)
    await pool.execute(
        "UPDATE edit_render_jobs SET status = 'done', progress_pct = 100, output_path = $1, completed_at = now() "
        "WHERE id = $2",
        output_path, job_id,
    )
    log.info(f"Render job #{job_id} completed -> {output_path}")


async def _finish_apply_render(
    pool: asyncpg.Pool, job_id: int, video_id: str, raw_dir: str, raw_path: str, tmp_output: str,
) -> None:
    """Swap a successful 'apply' render into raw/original.mp4 (issue #261).

    Backs up the current raw file (single-level — original_preapply.mp4 is
    overwritten on each apply, mirroring the original_pretrim.mp4 naming
    convention used by the trim endpoint), atomically replaces original.mp4
    with the new render, updates stored duration, marks the video stale if a
    transcript/chapters existed (cuts shift downstream timestamps), clears
    the editor draft so the next session starts empty, and auto-queues a
    transcode so the published HLS reflects the edit.
    """
    backup_path = os.path.join(raw_dir, "original_preapply.mp4")
    try:
        shutil.copy2(raw_path, backup_path)
    except OSError as e:
        log.error(f"Apply render #{job_id} failed to back up raw file: {e}")
        await pool.execute(
            "UPDATE edit_render_jobs SET status = 'error', error = $1, completed_at = now() WHERE id = $2",
            f"Could not back up current raw file before apply: {e}", job_id,
        )
        try:
            os.remove(tmp_output)
        except OSError:
            pass
        return

    os.replace(tmp_output, raw_path)  # atomic — original.mp4 is now the edited render

    new_duration = await asyncio.to_thread(get_duration, raw_path)

    video_row = await pool.fetchrow("SELECT transcript_status FROM videos WHERE id = $1", video_id)
    chapters_count = await pool.fetchval("SELECT COUNT(*) FROM video_chapters WHERE video_id = $1", video_id)
    had_transcript_or_chapters = bool(video_row and video_row["transcript_status"] == "ready") or bool(
        chapters_count and chapters_count > 0
    )

    await pool.execute(
        """
        UPDATE videos
           SET duration_s = COALESCE($1, duration_s),
               editor_applied_at = now(),
               pipeline_stale = $2,
               status = 'processing'
         WHERE id = $3
        """,
        new_duration, had_transcript_or_chapters, video_id,
    )
    await pool.execute("INSERT INTO transcode_jobs (video_id) VALUES ($1)", video_id)

    # Clear the draft — applied edits are now baked into original.mp4, so the
    # next editor session should start from an empty, un-muted, unstyled EDL.
    await pool.execute(
        """
        UPDATE video_editor_drafts
           SET edits = '[]', muted = false,
               style = '{"preset": "none", "pad_pct": 0, "radius_px": 0}',
               suggestions = '[]', updated_at = now()
         WHERE video_id = $1
        """,
        video_id,
    )

    # Ops log entry — mirrors admin_router._write_ops_log's format (the
    # worker runs in a separate process/container so it keeps its own copy
    # rather than importing the API router module).
    ops_path = os.path.join(raw_dir, "ops.json")
    try:
        from datetime import datetime, timezone
        ops = json.loads(open(ops_path).read()) if os.path.exists(ops_path) else []
        ops.append({"op": "editor-apply", "file": "original.mp4", "ts": datetime.now(timezone.utc).isoformat()})
        ops = ops[-50:]
        with open(ops_path, "w") as f:
            json.dump(ops, f)
    except Exception:
        pass

    await pool.execute(
        "UPDATE edit_render_jobs SET status = 'done', progress_pct = 100, completed_at = now() WHERE id = $1",
        job_id,
    )
    log.info(
        f"Apply render #{job_id} completed | video_id={video_id} duration={new_duration} "
        f"pipeline_stale={had_transcript_or_chapters}"
    )


async def run_worker():
    """Main worker loop — polls for jobs.

    Also claims editor-export render jobs (issue #260) from the same loop —
    no separate container. Transcode jobs are checked first each iteration;
    if none are pending, a render job is tried before sleeping. Both use the
    same `FOR UPDATE SKIP LOCKED` claim pattern.
    """
    global _current_job_id, _current_render_job_id
    log.info("Starting transcode worker...")
    log.info(f"Video storage: {settings.VIDEO_STORAGE_PATH}")
    log.info(f"Poll interval: {settings.TRANSCODE_POLL_INTERVAL}s")
    log.info(f"FFmpeg timeout: {settings.FFMPEG_TIMEOUT}s")

    # Probe GPU at startup
    gpu = get_gpu_info()
    if gpu["gpu_available"]:
        log.info(f"GPU encoding: {gpu['gpu_name']} (h264_nvenc)")
    else:
        log.info("GPU not available — using CPU encoding (libx264)")

    os.makedirs(settings.VIDEO_STORAGE_PATH, exist_ok=True)

    pool = await asyncpg.create_pool(settings.DATABASE_URL, min_size=1, max_size=3)

    # Reclaim jobs stuck in 'processing' from a previous crashed/killed worker
    result = await pool.execute(
        "UPDATE transcode_jobs SET status = 'pending', attempts = GREATEST(attempts - 1, 0) "
        "WHERE status = 'processing'"
    )
    reclaimed = int(result.split()[-1]) if result else 0
    if reclaimed:
        log.warning(f"Reclaimed {reclaimed} stuck job(s) from previous worker instance")

    # Same for render jobs — edit_render_jobs has no attempts/max_attempts
    # column, so a reclaim just puts it back to 'queued' unconditionally.
    render_result = await pool.execute(
        "UPDATE edit_render_jobs SET status = 'queued', started_at = NULL WHERE status = 'processing'"
    )
    render_reclaimed = int(render_result.split()[-1]) if render_result else 0
    if render_reclaimed:
        log.warning(f"Reclaimed {render_reclaimed} stuck render job(s) from previous worker instance")

    while not _shutdown.is_set():
        try:
            job = await claim_job(pool)
            if job:
                _current_job_id = job["id"]
                await process_job(pool, job)
                _current_job_id = None
                continue

            render_job = await claim_render_job(pool)
            if render_job:
                _current_render_job_id = render_job["id"]
                await process_render_job(pool, render_job)
                _current_render_job_id = None
                continue

            # Sleep in short increments so SIGTERM is noticed quickly
            for _ in range(settings.TRANSCODE_POLL_INTERVAL):
                if _shutdown.is_set():
                    break
                await asyncio.sleep(1)
        except Exception as e:
            log.error(f"Worker error: {e}")
            _current_job_id = None
            _current_render_job_id = None
            await asyncio.sleep(settings.TRANSCODE_POLL_INTERVAL)

    # Mark the in-flight job as cancelled so it can be retried next startup
    if _current_job_id is not None:
        try:
            await pool.execute(
                "UPDATE transcode_jobs SET status = 'cancelled', error = 'Worker shutdown during processing' "
                "WHERE id = $1 AND status = 'processing'",
                _current_job_id,
            )
            log.info(f"Marked job #{_current_job_id} as cancelled due to shutdown")
        except Exception as e:
            log.error(f"Failed to mark job as cancelled: {e}")

    # Same for an in-flight render job — put it back to 'queued' so the next
    # worker startup (or this one, after a restart) picks it back up rather
    # than leaving it stuck in 'processing' forever.
    if _current_render_job_id is not None:
        try:
            await pool.execute(
                "UPDATE edit_render_jobs SET status = 'queued', started_at = NULL "
                "WHERE id = $1 AND status = 'processing'",
                _current_render_job_id,
            )
            log.info(f"Requeued render job #{_current_render_job_id} due to shutdown")
        except Exception as e:
            log.error(f"Failed to requeue render job: {e}")

    await pool.close()
    log.info("Shutdown complete")


if __name__ == "__main__":
    asyncio.run(run_worker())
