"""
Auto-Mode Processing Worker
Polls auto_jobs table for pending jobs and runs the transcript → LLM pipeline.

Pipeline per video:
  1. transcript  — extract audio, send to remote transcript-service, save JSON
  2. metadata    — LLM generates title/description/category from transcript
  3. chapters    — LLM generates chapter markers from timestamped segments
  4. howto       — LLM generates a how-to guide from transcript

Run standalone: python worker/auto_processor.py
"""
import asyncio
import json
import os
import subprocess
import sys
import tempfile
from urllib.parse import urlparse, urlunparse

import asyncpg
import httpx
from loguru import logger as log

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from config import settings

POLL_INTERVAL = int(os.environ.get("AUTO_POLL_INTERVAL", "5"))
TRANSCRIPT_MOCK = os.environ.get("TRANSCRIPT_MOCK", "").lower() in ("1", "true", "yes")

_LOCAL_HOSTS = {"0.0.0.0", "localhost", "127.0.0.1"}

def _docker_url(url: str) -> str:
    """Replace loopback/unspecified hosts with host.docker.internal."""
    parsed = urlparse(url)
    if parsed.hostname in _LOCAL_HOSTS:
        netloc = f"host.docker.internal:{parsed.port}" if parsed.port else "host.docker.internal"
        parsed = parsed._replace(netloc=netloc)
    return urlunparse(parsed)


# ── Job claiming ─────────────────────────────────────────────────────────────

async def claim_job(pool: asyncpg.Pool):
    """Atomically claim one pending auto_job (SKIP LOCKED)."""
    return await pool.fetchrow(
        """
        UPDATE auto_jobs
        SET status = 'processing', started_at = now(), attempts = attempts + 1
        WHERE id = (
            SELECT id FROM auto_jobs
            WHERE status = 'pending' AND attempts < max_attempts
            ORDER BY created_at ASC
            LIMIT 1
            FOR UPDATE SKIP LOCKED
        )
        RETURNING *
        """
    )


async def mark_complete(pool: asyncpg.Pool, job_id: int):
    await pool.execute(
        "UPDATE auto_jobs SET status = 'completed', completed_at = now() WHERE id = $1",
        job_id,
    )


async def mark_failed(pool: asyncpg.Pool, job_id: int, error: str):
    row = await pool.fetchrow("SELECT attempts, max_attempts FROM auto_jobs WHERE id = $1", job_id)
    if row and row["attempts"] >= row["max_attempts"]:
        await pool.execute(
            "UPDATE auto_jobs SET status = 'failed', error = $1, completed_at = now() WHERE id = $2",
            error[:2000], job_id,
        )
    else:
        # Re-queue for retry
        await pool.execute(
            "UPDATE auto_jobs SET status = 'pending', error = $1 WHERE id = $2",
            error[:2000], job_id,
        )


# ── Helpers ───────────────────────────────────────────────────────────────────

def _video_raw_dir(video_id: str) -> str:
    return os.path.join(settings.VIDEO_STORAGE_PATH, video_id, "raw")


def _transcript_path(video_id: str) -> str:
    return os.path.join(settings.VIDEO_STORAGE_PATH, video_id, "transcript.json")


async def _get_transcript_settings(pool: asyncpg.Pool) -> dict:
    row = await pool.fetchrow("SELECT value FROM app_settings WHERE key = 'transcript_config'")
    if not row:
        return {"url": None, "api_key": None, "model": "large-v3"}
    cfg = json.loads(row["value"])
    return {
        "url": cfg.get("url"),
        "api_key": cfg.get("api_key"),
        "model": cfg.get("model") or "large-v3",
    }


async def _call_llm(pool: asyncpg.Pool, prompt: str) -> str:
    """Call the configured LLM provider."""
    row = await pool.fetchrow(
        "SELECT llm_provider, llm_model, llm_api_key FROM forge_settings WHERE is_active = true LIMIT 1"
    )
    if not row:
        raise RuntimeError("No active LLM settings found. Configure in Admin → Settings.")

    provider = row["llm_provider"]
    model = row["llm_model"]
    api_key = row.get("llm_api_key")

    async with httpx.AsyncClient(timeout=180.0) as client:
        if provider == "anthropic":
            if not api_key:
                raise RuntimeError("Anthropic API key not configured")
            resp = await client.post(
                "https://api.anthropic.com/v1/messages",
                headers={"x-api-key": api_key, "anthropic-version": "2023-06-01", "content-type": "application/json"},
                json={"model": model or "claude-sonnet-4-6", "max_tokens": 4096, "messages": [{"role": "user", "content": prompt}]},
            )
            resp.raise_for_status()
            return resp.json()["content"][0]["text"]

        elif provider == "openai":
            if not api_key:
                raise RuntimeError("OpenAI API key not configured")
            resp = await client.post(
                "https://api.openai.com/v1/chat/completions",
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json={"model": model or "gpt-4o-mini", "messages": [{"role": "user", "content": prompt}], "temperature": 0.3},
            )
            resp.raise_for_status()
            return resp.json()["choices"][0]["message"]["content"]

        elif provider == "ollama":
            ollama_url = settings.OLLAMA_BASE_URL.rstrip("/")
            if not model:
                tags = await client.get(f"{ollama_url}/api/tags")
                tags.raise_for_status()
                models = [m["name"] for m in tags.json().get("models", [])]
                if not models:
                    raise RuntimeError("No Ollama models available")
                model = models[0]
            resp = await client.post(
                f"{ollama_url}/api/generate",
                json={"model": model, "prompt": prompt, "stream": False},
            )
            resp.raise_for_status()
            return resp.json()["response"]

        else:
            raise RuntimeError(f"Unknown LLM provider: {provider}")


def _parse_json_strict(text: str):
    import re
    text = text.strip()
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text.strip())
    return json.loads(text.strip())


def _append_ops_log(video_id: str, entry: dict):
    ops_path = os.path.join(_video_raw_dir(video_id), "ops.json")
    ops = []
    if os.path.isfile(ops_path):
        try:
            with open(ops_path) as f:
                ops = json.load(f)
        except Exception:
            ops = []
    ops.append(entry)
    with open(ops_path, "w") as f:
        json.dump(ops, f, ensure_ascii=False)


# ── Mock transcript (for testing without GPU) ─────────────────────────────────

def _mock_transcript(duration_secs: float = 600.0) -> dict:
    """Generate a realistic-looking 10-minute transcript for offline testing."""
    lines = [
        "Welcome to this tutorial on machine learning fundamentals.",
        "Today we will explore the core concepts behind neural networks and deep learning.",
        "Let's start with the basics. A neural network is composed of layers of interconnected nodes.",
        "Each node, also called a neuron, applies a mathematical transformation to its inputs.",
        "The first layer is the input layer, which receives raw data such as images or text.",
        "Hidden layers sit between the input and output and learn increasingly abstract features.",
        "The final layer is the output layer, which produces the model's prediction.",
        "Training a neural network involves feeding it examples and adjusting the weights.",
        "This adjustment process is called backpropagation, and it uses gradient descent.",
        "Gradient descent minimizes the loss function by iteratively updating the parameters.",
        "One of the most common loss functions is cross-entropy loss, used for classification tasks.",
        "Activation functions like ReLU, sigmoid, and softmax introduce non-linearity into the model.",
        "Without non-linearity, a neural network would simply be a linear transformation.",
        "Convolutional neural networks, or CNNs, are particularly well suited for image data.",
        "They use convolutional filters to detect local patterns such as edges and textures.",
        "Pooling layers reduce the spatial dimensions, helping the network generalize.",
        "Recurrent neural networks, or RNNs, are designed for sequential data like text and audio.",
        "The LSTM architecture solves the vanishing gradient problem in long sequences.",
        "Transformers have largely replaced RNNs for natural language processing tasks.",
        "The attention mechanism allows the model to weigh the relevance of different tokens.",
        "BERT and GPT are two influential transformer-based models trained on large corpora.",
        "Transfer learning allows us to fine-tune pre-trained models on domain-specific data.",
        "This dramatically reduces the amount of labelled data and compute required.",
        "Overfitting occurs when a model learns the training data too well and fails to generalize.",
        "Regularization techniques such as dropout and weight decay help prevent overfitting.",
        "Data augmentation artificially expands the training set by applying transformations.",
        "Batch normalization stabilizes training by normalizing the inputs to each layer.",
        "Hyperparameter tuning involves finding the best learning rate, batch size, and architecture.",
        "Tools like Weights and Biases and MLflow help track experiments and compare runs.",
        "Model evaluation should always be done on a held-out test set to avoid data leakage.",
        "Precision, recall, and F1 score are important metrics for imbalanced classification tasks.",
        "ROC curves and AUC provide a comprehensive view of a classifier's performance.",
        "In regression tasks, mean squared error and mean absolute error are common metrics.",
        "Deploying a model to production requires packaging it as a REST API or batch pipeline.",
        "Docker and Kubernetes are widely used for containerizing and orchestrating ML services.",
        "Model monitoring tracks data drift and performance degradation over time.",
        "Retraining pipelines can be triggered automatically when performance drops below a threshold.",
        "Responsible AI practices include fairness auditing, explainability, and privacy preservation.",
        "Thank you for watching. In the next session we will implement a model from scratch.",
    ]

    segments = []
    t = 0.0
    seg_duration = duration_secs / len(lines)
    for line in lines:
        end = round(t + seg_duration, 2)
        segments.append({"start": round(t, 2), "end": end, "text": line})
        t = end

    return {
        "language": "en",
        "duration": duration_secs,
        "full_text": " ".join(s["text"] for s in segments),
        "segments": segments,
    }


# ── Job handlers ──────────────────────────────────────────────────────────────

async def run_transcript_job(pool: asyncpg.Pool, job: asyncpg.Record):
    """Extract audio and send to transcript-service."""
    video_id = str(job["video_id"])
    log.info("Transcript job | video_id={}", video_id)

    await pool.execute(
        "UPDATE videos SET transcript_status = 'processing' WHERE id = $1", video_id
    )

    if TRANSCRIPT_MOCK:
        log.warning("TRANSCRIPT_MOCK=true — using synthetic 10-minute transcript (no GPU needed)")
        transcript = _mock_transcript(duration_secs=600.0)
    else:
        ts_cfg = await _get_transcript_settings(pool)
        if not ts_cfg["url"]:
            raise RuntimeError("Transcript service URL not configured. Set it in Admin → Settings.")

        raw_dir = _video_raw_dir(video_id)
        input_path = os.path.join(raw_dir, "original.mp4")
        if not os.path.isfile(input_path):
            raise RuntimeError(f"Source video not found: {input_path}")

        # Extract audio to temp WAV
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
            audio_path = tmp.name

        try:
            cmd = [
                settings.FFMPEG_PATH, "-y", "-i", input_path,
                "-vn", "-ac", "1", "-ar", "16000", "-f", "wav", audio_path,
            ]
            log.debug("Extracting audio | cmd={}", " ".join(cmd))
            result = subprocess.run(cmd, capture_output=True, timeout=600)
            if result.returncode != 0:
                raise RuntimeError(f"ffmpeg audio extract failed: {result.stderr.decode()[:500]}")

            service_url = _docker_url(ts_cfg["url"].rstrip("/"))
            api_key = ts_cfg["api_key"] or ""
            model = ts_cfg["model"] or "large-v3"

            log.info("Sending audio to transcript service | url={}", service_url)
            async with httpx.AsyncClient(timeout=600.0) as client:
                with open(audio_path, "rb") as audio_file:
                    resp = await client.post(
                        f"{service_url}/transcribe",
                        headers={"X-API-Key": api_key},
                        data={"model": model},
                        files={"audio": ("audio.wav", audio_file, "audio/wav")},
                    )
                if resp.status_code == 401:
                    raise RuntimeError("Transcript service rejected API key (401)")
                if resp.status_code != 200:
                    raise RuntimeError(f"Transcript service error: HTTP {resp.status_code} — {resp.text[:300]}")
                transcript = resp.json()

        finally:
            try:
                os.unlink(audio_path)
            except OSError:
                pass

    # Save transcript JSON
    t_path = _transcript_path(video_id)
    os.makedirs(os.path.dirname(t_path), exist_ok=True)
    with open(t_path, "w") as f:
        json.dump(transcript, f, ensure_ascii=False, indent=2)

    duration = transcript.get("duration")
    language = transcript.get("language", "")

    await pool.execute(
        """UPDATE videos
           SET transcript_status = 'ready', transcript_path = $1
           WHERE id = $2""",
        t_path, video_id,
    )

    import time
    _append_ops_log(video_id, {
        "op": "transcript",
        "ts": time.time(),
        "language": language,
        "duration": duration,
    })

    # Cascade: enqueue LLM jobs
    for kind in ("metadata", "chapters", "howto"):
        await pool.execute(
            "UPDATE auto_jobs SET status = 'cancelled' WHERE video_id = $1 AND kind = $2 AND status IN ('pending', 'failed')",
            video_id, kind,
        )
        await pool.fetchval(
            "INSERT INTO auto_jobs (video_id, kind) VALUES ($1, $2) RETURNING id",
            video_id, kind,
        )
        log.info("Enqueued follow-up job | video_id={} kind={}", video_id, kind)


async def run_metadata_job(pool: asyncpg.Pool, job: asyncpg.Record):
    """Generate title/description/category from transcript using LLM."""
    from video.llm_prompts import metadata_prompt, parse_json_strict

    video_id = str(job["video_id"])
    log.info("Metadata job | video_id={}", video_id)

    t_path = _transcript_path(video_id)
    if not os.path.isfile(t_path):
        raise RuntimeError("Transcript not found. Run transcript job first.")
    with open(t_path) as f:
        transcript = json.load(f)

    video = await pool.fetchrow("SELECT title FROM videos WHERE id = $1", video_id)
    full_text = transcript.get("full_text", "")
    prompt = metadata_prompt(full_text, video_title=video["title"] if video else "")

    raw = await _call_llm(pool, prompt)
    try:
        data = parse_json_strict(raw)
    except Exception:
        # Retry once with a stricter instruction
        raw = await _call_llm(pool, prompt + "\n\nIMPORTANT: Return ONLY the JSON object, nothing else.")
        data = parse_json_strict(raw)

    title = str(data.get("title", "")).strip()
    description = str(data.get("description", "")).strip()
    category = str(data.get("category", "Other")).strip()

    if title:
        await pool.execute(
            "UPDATE videos SET title = $1, description = $2, category = $3 WHERE id = $4",
            title, description, category, video_id,
        )
        log.info("Metadata updated | video_id={} title={}", video_id, title)


async def run_chapters_job(pool: asyncpg.Pool, job: asyncpg.Record):
    """Generate chapters from timestamped transcript segments using LLM."""
    from video.llm_prompts import chapters_prompt, parse_json_strict

    video_id = str(job["video_id"])
    log.info("Chapters job | video_id={}", video_id)

    t_path = _transcript_path(video_id)
    if not os.path.isfile(t_path):
        raise RuntimeError("Transcript not found. Run transcript job first.")
    with open(t_path) as f:
        transcript = json.load(f)

    segments = transcript.get("segments", [])
    if not segments:
        log.warning("No segments in transcript | video_id={}", video_id)
        return

    prompt = chapters_prompt(segments)
    raw = await _call_llm(pool, prompt)
    try:
        chapters = parse_json_strict(raw)
    except Exception:
        raw = await _call_llm(pool, prompt + "\n\nIMPORTANT: Return ONLY the JSON array, nothing else.")
        chapters = parse_json_strict(raw)

    if not isinstance(chapters, list):
        raise RuntimeError(f"LLM returned unexpected type: {type(chapters)}")

    # Replace existing chapters
    await pool.execute("DELETE FROM video_chapters WHERE video_id = $1", video_id)
    for idx, ch in enumerate(chapters):
        title = str(ch.get("title", "")).strip()
        start_time = int(ch.get("start_time", 0))
        if not title:
            continue
        await pool.execute(
            "INSERT INTO video_chapters (video_id, title, start_time, sort_order) VALUES ($1, $2, $3, $4)",
            video_id, title, start_time, idx,
        )
    log.info("Chapters written | video_id={} count={}", video_id, len(chapters))


async def run_howto_job(pool: asyncpg.Pool, job: asyncpg.Record):
    """Generate how-to guide from transcript using LLM."""
    from video.llm_prompts import howto_prompt, parse_json_strict

    video_id = str(job["video_id"])
    log.info("Howto job | video_id={}", video_id)

    t_path = _transcript_path(video_id)
    if not os.path.isfile(t_path):
        raise RuntimeError("Transcript not found. Run transcript job first.")
    with open(t_path) as f:
        transcript = json.load(f)

    video = await pool.fetchrow("SELECT title FROM videos WHERE id = $1", video_id)
    full_text = transcript.get("full_text", "")
    prompt = howto_prompt(full_text, video_title=video["title"] if video else "")

    raw = await _call_llm(pool, prompt)
    try:
        data = parse_json_strict(raw)
    except Exception:
        raw = await _call_llm(pool, prompt + "\n\nIMPORTANT: Return ONLY the JSON object, nothing else.")
        data = parse_json_strict(raw)

    title = str(data.get("title", "How-to Guide")).strip()
    content = str(data.get("content", "")).strip()

    # Upsert howto guide
    existing = await pool.fetchrow("SELECT id FROM howto_guides WHERE video_id = $1", video_id)
    if existing:
        await pool.execute(
            "UPDATE howto_guides SET title = $1, content = $2, version = '2.0', updated_at = now() WHERE video_id = $3",
            title, content, video_id,
        )
    else:
        await pool.execute(
            "INSERT INTO howto_guides (video_id, title, content) VALUES ($1, $2, $3)",
            video_id, title, content,
        )
    log.info("How-to guide written | video_id={} title={}", video_id, title)


# ── Main loop ─────────────────────────────────────────────────────────────────

HANDLERS = {
    "transcript": run_transcript_job,
    "metadata": run_metadata_job,
    "chapters": run_chapters_job,
    "howto": run_howto_job,
}


async def main():
    log.info("Auto-processor starting | poll_interval={}s", POLL_INTERVAL)
    pool = await asyncpg.create_pool(settings.DATABASE_URL, min_size=2, max_size=5)
    log.info("Database pool established")

    while True:
        job = await claim_job(pool)
        if not job:
            await asyncio.sleep(POLL_INTERVAL)
            continue

        job_id = job["id"]
        kind = job["kind"]
        video_id = str(job["video_id"])
        log.info("Processing auto_job | id={} kind={} video_id={}", job_id, kind, video_id)

        handler = HANDLERS.get(kind)
        if not handler:
            await mark_failed(pool, job_id, f"Unknown job kind: {kind}")
            continue

        try:
            await handler(pool, job)
            await mark_complete(pool, job_id)
            log.info("Auto_job complete | id={} kind={} video_id={}", job_id, kind, video_id)
        except Exception as exc:
            log.error("Auto_job failed | id={} kind={} error={}", job_id, kind, str(exc))
            if kind == "transcript":
                await pool.execute(
                    "UPDATE videos SET transcript_status = 'error', transcript_error = $1 WHERE id = $2",
                    str(exc)[:1000], video_id,
                )
            await mark_failed(pool, job_id, str(exc)[:2000])


if __name__ == "__main__":
    asyncio.run(main())
