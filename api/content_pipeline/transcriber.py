"""
Audio extraction + Whisper transcription for uploaded videos.

Supported backends (tried in order):
  1. OpenAI Whisper API   — when LLM provider is 'openai' and api_key is set
  2. Local whisper CLI    — if `whisper` is on PATH
  3. faster-whisper lib   — if faster_whisper Python package is installed

Audio is extracted with ffmpeg (already in the container).
"""
from __future__ import annotations

import asyncio
import os
import tempfile
from pathlib import Path

import httpx
from loguru import logger as log

from articles.llm import get_llm_settings
from config import settings


async def extract_audio(video_path: str, output_path: str) -> bool:
    """Extract mono 16kHz WAV audio from video using ffmpeg."""
    cmd = [
        settings.FFMPEG_PATH, "-y", "-i", video_path,
        "-vn",                  # no video
        "-acodec", "pcm_s16le", # PCM wav
        "-ar", "16000",         # 16kHz sample rate (Whisper optimal)
        "-ac", "1",             # mono
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


async def _transcribe_openai(audio_path: str, api_key: str) -> str | None:
    """Call OpenAI Whisper API to transcribe the audio file."""
    try:
        async with httpx.AsyncClient(timeout=180.0) as client:
            with open(audio_path, "rb") as f:
                resp = await client.post(
                    "https://api.openai.com/v1/audio/transcriptions",
                    headers={"Authorization": f"Bearer {api_key}"},
                    files={"file": (Path(audio_path).name, f, "audio/wav")},
                    data={"model": "whisper-1", "response_format": "text"},
                )
        if resp.status_code == 200:
            return resp.text.strip()
        log.error(f"OpenAI Whisper API error {resp.status_code}: {resp.text[:300]}")
        return None
    except Exception as e:
        log.error(f"OpenAI Whisper call error: {e}")
        return None


async def _transcribe_local_cli(audio_path: str) -> str | None:
    """Use the `whisper` CLI tool if available."""
    try:
        # Check whisper is available
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
        proc = await asyncio.create_subprocess_exec(
            "whisper", audio_path,
            "--model", "base",
            "--output_format", "txt",
            "--output_dir", out_dir,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            await asyncio.wait_for(proc.communicate(), timeout=600)
        except asyncio.TimeoutError:
            proc.kill()
            return None

        # Whisper writes <filename>.txt
        txt_path = Path(out_dir) / (Path(audio_path).stem + ".txt")
        if txt_path.exists():
            return txt_path.read_text(errors="replace").strip()
        return None
    except Exception as e:
        log.error(f"whisper CLI error: {e}")
        return None
    finally:
        import shutil
        shutil.rmtree(out_dir, ignore_errors=True)


async def _transcribe_faster_whisper(audio_path: str) -> str | None:
    """Use faster-whisper Python library if installed."""
    try:
        from faster_whisper import WhisperModel  # type: ignore
    except ImportError:
        return None

    try:
        def _run() -> str:
            model = WhisperModel("base", device="cpu", compute_type="int8")
            segments, _ = model.transcribe(audio_path, beam_size=5)
            return " ".join(seg.text.strip() for seg in segments)

        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, _run)
    except Exception as e:
        log.error(f"faster-whisper error: {e}")
        return None


async def transcribe_video(video_id: str) -> str | None:
    """
    Locate the raw video file, extract audio, and transcribe it.
    Returns transcript text or None if transcription is not possible.
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

        # Check file actually has data
        if not os.path.exists(audio_path) or os.path.getsize(audio_path) < 1024:
            log.warning(f"transcribe_video: extracted audio is empty for {video_id}")
            return None

        # Try backends in order
        llm = await get_llm_settings()

        # 1. OpenAI Whisper API
        if llm["provider"] == "openai" and llm.get("api_key"):
            log.info(f"Transcribing {video_id} via OpenAI Whisper API")
            transcript = await _transcribe_openai(audio_path, llm["api_key"])
            if transcript:
                return transcript

        # 2. Local whisper CLI
        log.info(f"Transcribing {video_id} via local whisper CLI")
        transcript = await _transcribe_local_cli(audio_path)
        if transcript:
            return transcript

        # 3. faster-whisper
        log.info(f"Transcribing {video_id} via faster-whisper")
        transcript = await _transcribe_faster_whisper(audio_path)
        if transcript:
            return transcript

        log.warning(f"transcribe_video: no transcription backend available for {video_id}")
        return None

    finally:
        try:
            os.unlink(audio_path)
        except OSError:
            pass
