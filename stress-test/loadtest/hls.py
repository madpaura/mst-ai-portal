"""HLS streaming-load simulation.

A real Ignite video is served as an adaptive-bitrate HLS ladder under
``/streams/{id}/hls/master.m3u8``. Streaming a video means: fetch the master
manifest, pick a variant, fetch its media playlist, then pull a run of ``.ts``
segments — the heaviest bandwidth path in the portal. This module replays that
sequence so the suite can simulate N users watching at once.
"""
from __future__ import annotations

import posixpath
import time
from typing import List, Optional

import httpx

from .metrics import Sample


def _parse_uris(text: str) -> List[str]:
    """Return non-comment, non-blank lines (i.e. URIs) from an M3U8 manifest."""
    return [ln.strip() for ln in text.splitlines() if ln.strip() and not ln.startswith("#")]


def _resolve(base_path: str, uri: str) -> str:
    """Resolve a possibly-relative manifest URI against the manifest's directory."""
    if uri.startswith("http://") or uri.startswith("https://"):
        return uri
    if uri.startswith("/"):
        return uri
    base_dir = posixpath.dirname(base_path)
    return posixpath.normpath(posixpath.join(base_dir, uri))


def ready_video_hls_paths(videos: List[dict]) -> List[str]:
    """Extract HLS master paths from discovered video objects that are ready."""
    paths = []
    for v in videos:
        p = v.get("hls_path")
        if p and (v.get("status") in (None, "ready")):
            paths.append(p)
    return paths


async def stream_session(
    client: httpx.AsyncClient,
    master_path: str,
    *,
    segments: int = 6,
    stage: int = 0,
) -> List[Sample]:
    """Simulate one viewing session. Returns a list of Samples (master+variant+segments)."""
    out: List[Sample] = []

    master_text = await _fetch(client, "hls.master", master_path, out, stage)
    if master_text is None:
        return out

    variants = _parse_uris(master_text)
    if not variants:
        # master may itself be a media playlist (single rendition)
        media_path, media_text = master_path, master_text
    else:
        variant_uri = variants[len(variants) // 2]  # middle rendition ~ 720p
        media_path = _resolve(master_path, variant_uri)
        media_text = await _fetch(client, "hls.variant", media_path, out, stage)
        if media_text is None:
            return out

    seg_uris = _parse_uris(media_text)[:segments]
    for uri in seg_uris:
        seg_path = _resolve(media_path, uri)
        await _fetch(client, "hls.segment", seg_path, out, stage)

    return out


async def _fetch(client, label: str, path: str, out: List[Sample], stage: int) -> Optional[str]:
    t0 = time.perf_counter()
    ts = time.time()
    status, nbytes, err, text = 0, 0, None, None
    try:
        resp = await client.get(path)
        status = resp.status_code
        nbytes = len(resp.content)
        if status == 200:
            text = resp.text
    except httpx.TimeoutException:
        err = "timeout"
    except httpx.HTTPError as e:
        err = f"http_error:{type(e).__name__}"
    except Exception as e:  # pragma: no cover
        err = f"error:{type(e).__name__}"

    latency_ms = (time.perf_counter() - t0) * 1000.0
    ok = err is None and status == 200
    if err is None and status != 200:
        err = f"http_{status}"
    out.append(Sample(label=label, method="GET", status=status, ok=ok,
                       latency_ms=latency_ms, bytes=nbytes, t_start=ts,
                       stage=stage, error=err))
    return text
