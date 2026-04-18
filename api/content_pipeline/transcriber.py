"""
Audio extraction + Whisper transcription for uploaded videos.

Returns a TranscriptResult with both plain text and WebVTT.

Supported backends (tried in order):
  1. OpenAI Whisper API   — when LLM provider is 'openai' and api_key is set
  2. Local whisper CLI    — if `whisper` is on PATH
  3. faster-whisper lib   — if faster_whisper Python package is installed
"""
from __future__ import annotations

import asyncio
import os
import tempfile
from dataclasses import dataclass
from pathlib import Path

import httpx
from loguru import logger as log

from articles.llm import get_llm_settings
from config import settings
from .vtt_utils import whisper_json_to_vtt


@dataclass
class TranscriptResult:
    text: str
    vtt: str | None = None     # WebVTT with timestamps (None if unavailable)
    provider: str = "whisper"


async def extract_audio(video_path: str, output_path: str) -> bool:
    """Extract mono 16kHz WAV audio from video using ffmpeg."""
    cmd = [
        settings.FFMPEG_PATH, "-y", "-i", video_path,
        "-vn",
        "-acodec", "pcm_s16le",
        "-ar", "16000",
        "-ac", "1",
        output_path,
    ]
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        _, stderr = await asyncio.wait_for(proc.communicate(), timeout=300)
        if proc.returncode != 0:
            log.error(f"ffmpeg audio extraction failed: {stderr.decode(errors='replace')[-500:]}")
            return False
        return True
    except asyncio.TimeoutError:
        log.error("ffmpeg audio extraction timed out")
        return False
    except Exception as e:
        log.error(f"ffmpeg audio extraction error: {e}")
        return False


async def _transcribe_openai(audio_path: str, api_key: str) -> TranscriptResult | None:
    """Call OpenAI Whisper API (verbose_json for timestamps + plain text)."""
    try:
        async with httpx.AsyncClient(timeout=180.0) as client:
            # verbose_json gives us segments with start/end timestamps
            with open(audio_path, "rb") as f:
                resp = await client.post(
                    "https://api.openai.com/v1/audio/transcriptions",
                    headers={"Authorization": f"Bearer {api_key}"},
                    files={"file": (Path(audio_path).name, f, "audio/wav")},
                    data={"model": "whisper-1", "response_format": "verbose_json"},
                )
        if resp.status_code == 200:
            data = resp.json()
            text = data.get("text", "").strip()
            segments = data.get("segments", [])
            vtt = whisper_json_to_vtt(segments) if segments else None
            return TranscriptResult(text=text, vtt=vtt, provider="openai-whisper")
        log.error(f"OpenAI Whisper API error {resp.status_code}: {resp.text[:300]}")
        return None
    except Exception as e:
        log.error(f"OpenAI Whisper call error: {e}")
        return None


async def _transcribe_local_cli(audio_path: str) -> TranscriptResult | None:
    """Use the `whisper` CLI tool if available. Outputs VTT alongside text."""
    try:
        check = await asyncio.create_subprocess_exec(
            "whisper", "--help",
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
        )
        await check.wait()
        if check.returncode not in (0, 1):
            return None
    except FileNotFoundError:
        return None

    out_dir = tempfile.mkdtemp()
    try:
        # Request both txt and vtt outputs
        proc = await asyncio.create_subprocess_exec(
            "whisper", audio_path,
            "--model", "base",
            "--output_format", "all",  # writes .txt, .vtt, .srt, .json, .tsv
            "--output_dir", out_dir,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            await asyncio.wait_for(proc.communicate(), timeout=600)
        except asyncio.TimeoutError:
            proc.kill()
            return None

        stem = Path(audio_path).stem
        txt_path = Path(out_dir) / f"{stem}.txt"
        vtt_path = Path(out_dir) / f"{stem}.vtt"

        text = txt_path.read_text(errors="replace").strip() if txt_path.exists() else None
        vtt = vtt_path.read_text(errors="replace").strip() if vtt_path.exists() else None

        if text:
            return TranscriptResult(text=text, vtt=vtt, provider="whisper-cli")
        return None
    except Exception as e:
        log.error(f"whisper CLI error: {e}")
        return None
    finally:
        import shutil
        shutil.rmtree(out_dir, ignore_errors=True)


async def _transcribe_faster_whisper(audio_path: str) -> TranscriptResult | None:
    """Use faster-whisper Python library if installed."""
    try:
        from faster_whisper import WhisperModel  # type: ignore
    except ImportError:
        return None

    try:
        def _run() -> TranscriptResult:
            model = WhisperModel("base", device="cpu", compute_type="int8")
            segments, _ = model.transcribe(audio_path, beam_size=5)
            seg_list = list(segments)
            text = " ".join(seg.text.strip() for seg in seg_list)
            vtt_segments = [{"start": seg.start, "end": seg.end, "text": seg.text.strip()} for seg in seg_list]
            from .vtt_utils import whisper_json_to_vtt as _vtt
            vtt = _vtt(vtt_segments) if vtt_segments else None
            return TranscriptResult(text=text, vtt=vtt, provider="faster-whisper")

        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, _run)
    except Exception as e:
        log.error(f"faster-whisper error: {e}")
        return None


async def transcribe_video(video_id: str) -> TranscriptResult | None:
    """
    Locate the raw video file, extract audio, and transcribe it.
    Returns a TranscriptResult with text + VTT, or None if unavailable.
    """
    raw_path = Path(settings.VIDEO_STORAGE_PATH) / video_id / "raw" / "original.mp4"
    if not raw_path.exists():
        log.warning(f"transcribe_video: no raw file at {raw_path}")
        return None

    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        audio_path = tmp.name

    try:
        ok = await extract_audio(str(raw_path), audio_path)
        if not ok:
            return None

        if not os.path.exists(audio_path) or os.path.getsize(audio_path) < 1024:
            log.warning(f"transcribe_video: extracted audio is empty for {video_id}")
            return None

        llm = await get_llm_settings()

        if llm["provider"] == "openai" and llm.get("api_key"):
            log.info(f"Transcribing {video_id} via OpenAI Whisper API")
            result = await _transcribe_openai(audio_path, llm["api_key"])
            if result:
                return result

        log.info(f"Transcribing {video_id} via local whisper CLI")
        result = await _transcribe_local_cli(audio_path)
        if result:
            return result

        log.info(f"Transcribing {video_id} via faster-whisper")
        result = await _transcribe_faster_whisper(audio_path)
        if result:
            return result

        log.warning(f"transcribe_video: no transcription backend available for {video_id}")
        return None

    finally:
        try:
            os.unlink(audio_path)
        except OSError:
            pass
