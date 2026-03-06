"""
FFmpeg Transcoding Worker
Polls PostgreSQL for pending transcode jobs and processes them.

Run standalone: python -m worker.transcoder
"""
import asyncio
import os
import subprocess
import sys

import asyncpg

# Allow running as standalone module
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from config import settings


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
    """Run FFmpeg to transcode a single quality tier."""
    profile = QUALITY_PROFILES[quality]
    hls_dir = os.path.join(output_dir, quality)
    os.makedirs(hls_dir, exist_ok=True)

    cmd = [
        settings.FFMPEG_PATH, "-y", "-i", input_path,
        "-vf", f"scale=-2:{profile['scale']}",
        "-c:v", "libx264", "-crf", str(crf), "-preset", "fast",
        "-c:a", "aac", "-b:a", profile["audio_bitrate"],
        "-hls_time", "6", "-hls_playlist_type", "vod",
        "-hls_segment_filename", os.path.join(hls_dir, "seg_%03d.ts"),
        os.path.join(hls_dir, "index.m3u8"),
    ]

    print(f"  [ffmpeg] Transcoding {quality} (CRF={crf})...")
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"  [ffmpeg] ERROR {quality}: {result.stderr[-500:]}")
        return False
    print(f"  [ffmpeg] {quality} done")
    return True


def generate_thumbnail(input_path: str, output_path: str, timestamp: int = 5):
    """Generate a thumbnail from the video."""
    cmd = [
        settings.FFMPEG_PATH, "-y", "-i", input_path,
        "-ss", str(timestamp), "-vframes", "1", "-q:v", "2",
        output_path,
    ]
    subprocess.run(cmd, capture_output=True)


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
    print(f"  [manifest] master.m3u8 written with {len(qualities)} quality tier(s)")


def get_duration(input_path: str) -> int | None:
    """Get video duration in seconds using ffprobe."""
    cmd = [
        "ffprobe", "-v", "error", "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1", input_path,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode == 0 and result.stdout.strip():
        try:
            return int(float(result.stdout.strip()))
        except ValueError:
            pass
    return None


async def process_job(pool: asyncpg.Pool, job):
    """Process a single transcode job."""
    video_id = str(job["video_id"])
    job_id = job["id"]
    print(f"\n[worker] Processing job #{job_id} for video {video_id}")

    video_dir = os.path.join(settings.VIDEO_STORAGE_PATH, video_id)
    raw_path = os.path.join(video_dir, "raw", "original.mp4")

    if not os.path.exists(raw_path):
        error = f"Raw file not found: {raw_path}"
        print(f"  [error] {error}")
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
    print(f"[worker] Job #{job_id} completed successfully")


async def run_worker():
    """Main worker loop — polls for jobs."""
    print("[worker] Starting transcode worker...")
    print(f"[worker] Video storage: {settings.VIDEO_STORAGE_PATH}")
    print(f"[worker] Poll interval: {settings.TRANSCODE_POLL_INTERVAL}s")

    os.makedirs(settings.VIDEO_STORAGE_PATH, exist_ok=True)

    pool = await asyncpg.create_pool(settings.DATABASE_URL, min_size=1, max_size=3)

    while True:
        try:
            job = await claim_job(pool)
            if job:
                await process_job(pool, job)
            else:
                await asyncio.sleep(settings.TRANSCODE_POLL_INTERVAL)
        except KeyboardInterrupt:
            break
        except Exception as e:
            print(f"[worker] Error: {e}")
            await asyncio.sleep(settings.TRANSCODE_POLL_INTERVAL)

    await pool.close()
    print("[worker] Shutdown")


if __name__ == "__main__":
    asyncio.run(run_worker())
