"""
Transcript Service — GPU-hosted speech-to-text via faster-whisper.

Deploy on a machine with a CUDA GPU. The main portal's auto-processor
worker calls this service over HTTP.

Environment:
  TRANSCRIPT_API_KEY   — shared secret (X-API-Key header)
  TRANSCRIPT_MODEL     — faster-whisper model size (default: large-v3)
  TRANSCRIPT_DEVICE    — cuda | cpu (default: cuda)
  TRANSCRIPT_COMPUTE   — float16 | int8 | float32 (default: float16)
"""

import os
import tempfile
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse

API_KEY = os.environ.get("TRANSCRIPT_API_KEY", "")
MODEL_SIZE = os.environ.get("TRANSCRIPT_MODEL", "large-v3")
DEVICE = os.environ.get("TRANSCRIPT_DEVICE", "cuda")
COMPUTE_TYPE = os.environ.get("TRANSCRIPT_COMPUTE", "float16")

_model = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _model
    from faster_whisper import WhisperModel
    print(f"[startup] Loading faster-whisper model={MODEL_SIZE} device={DEVICE} compute={COMPUTE_TYPE}")
    _model = WhisperModel(MODEL_SIZE, device=DEVICE, compute_type=COMPUTE_TYPE)
    print("[startup] Model ready")
    yield
    _model = None


app = FastAPI(title="MST Transcript Service", lifespan=lifespan)


def _check_api_key(request: Request):
    if not API_KEY:
        return  # no key configured → open (not recommended for production)
    provided = request.headers.get("X-API-Key", "")
    if provided != API_KEY:
        raise HTTPException(status_code=401, detail="Invalid or missing X-API-Key")


@app.get("/health")
async def health(request: Request):
    _check_api_key(request)
    return {
        "status": "ok",
        "model": MODEL_SIZE,
        "device": DEVICE,
        "compute": COMPUTE_TYPE,
        "gpu": DEVICE == "cuda",
    }


@app.post("/transcribe")
async def transcribe(
    request: Request,
    audio: UploadFile = File(...),
    language: Optional[str] = Form(None),
    model: Optional[str] = Form(None),
):
    """
    Accepts a WAV (or MP4) audio file and returns a transcript with segments.

    Response:
    {
      "language": "en",
      "duration": 1234.5,
      "full_text": "...",
      "segments": [{"start": 0.0, "end": 4.5, "text": "Hello..."}]
    }
    """
    _check_api_key(request)

    if _model is None:
        raise HTTPException(status_code=503, detail="Model not loaded")

    # Save upload to temp file
    suffix = os.path.splitext(audio.filename or "audio.wav")[1] or ".wav"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp_path = tmp.name
        content = await audio.read()
        tmp.write(content)

    try:
        segments_iter, info = _model.transcribe(
            tmp_path,
            language=language or None,
            beam_size=5,
            word_timestamps=False,
        )
        segments = []
        for seg in segments_iter:
            segments.append({
                "start": round(seg.start, 2),
                "end": round(seg.end, 2),
                "text": seg.text.strip(),
            })

        full_text = " ".join(s["text"] for s in segments)
        return {
            "language": info.language,
            "duration": round(info.duration, 2),
            "full_text": full_text,
            "segments": segments,
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Transcription failed: {str(exc)[:300]}")
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=9100, workers=1)
