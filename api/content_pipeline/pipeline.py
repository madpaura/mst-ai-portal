"""
Orchestrates the content pipeline for videos and articles.

Usage:
    asyncio.create_task(process_video(video_id))
    asyncio.create_task(process_article(article_id))
    asyncio.create_task(transcribe_and_update(video_id))   # after file upload
"""
from __future__ import annotations

import asyncio
import json
import re
from loguru import logger as log

from articles.llm import call_llm
from database import get_write_db, get_read_db
from .summarizer import summarize_video, summarize_article
from .transcriber import transcribe_video


# ── How-to guide generation ───────────────────────────────────────────────────

async def generate_howto(video_id: str, title: str, transcript: str) -> None:
    """Generate a structured how-to guide from the transcript and store it."""
    prompt = (
        f"You are a technical writer creating a practical how-to guide for an educational video.\n\n"
        f"Video title: {title}\n\n"
        f"Transcript:\n{transcript[:5000]}\n\n"
        "Write a clear, well-structured how-to guide in Markdown that covers:\n"
        "1. A brief overview (1-2 sentences)\n"
        "2. Prerequisites (if applicable)\n"
        "3. Step-by-step instructions (numbered list)\n"
        "4. Key takeaways or tips\n\n"
        "Use proper Markdown: ## headings, code blocks where relevant, bullet points.\n"
        "Be concise and practical. Do not invent steps not covered in the transcript."
    )
    try:
        content = await call_llm(prompt)
        db = await get_write_db()
        await db.execute(
            """
            INSERT INTO howto_guides (video_id, title, content, version)
            VALUES ($1, $2, $3, 'ai-1.0')
            ON CONFLICT (video_id) DO UPDATE
                SET title   = EXCLUDED.title,
                    content = EXCLUDED.content,
                    version = EXCLUDED.version,
                    updated_at = now()
            """,
            video_id,
            f"How to: {title}",
            content,
        )
        log.info(f"content_pipeline: how-to guide generated for {video_id}")
    except Exception as e:
        log.error(f"content_pipeline: how-to generation failed for {video_id}: {e}")


# ── Auto chapter classification ───────────────────────────────────────────────

def _extract_json(text: str) -> list:
    text = text.strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    match = re.search(r'\[[\s\S]*\]', text)
    if match:
        try:
            return json.loads(match.group())
        except json.JSONDecodeError:
            pass
    return []


async def generate_chapters(video_id: str, title: str, transcript: str, duration_s: int | None) -> None:
    """
    Classify the transcript into chapters using LLM and store them.
    Only generates chapters if none exist yet (preserves manually created ones).
    """
    db_r = await get_read_db()
    existing = await db_r.fetchval(
        "SELECT COUNT(*) FROM video_chapters WHERE video_id = $1", video_id
    )
    if existing and existing > 0:
        log.info(f"content_pipeline: skipping chapters for {video_id} — {existing} already exist")
        return

    duration_hint = f"The video is approximately {duration_s} seconds long." if duration_s else ""

    prompt = (
        f"You are a video editor creating chapter markers for an educational video.\n\n"
        f"Video title: {title}\n"
        f"{duration_hint}\n\n"
        f"Transcript:\n{transcript[:6000]}\n\n"
        "Identify 4-8 logical chapter breaks based on topic transitions.\n"
        "Estimate the start time in seconds for each chapter based on where in the transcript the topic appears.\n"
        "Respond with ONLY a valid JSON array (no explanation), like this:\n"
        '[\n'
        '  {"title": "Introduction", "start_time": 0},\n'
        '  {"title": "Core Concepts", "start_time": 45},\n'
        '  {"title": "Live Demo", "start_time": 180}\n'
        ']\n\n'
        "Rules:\n"
        "- First chapter MUST have start_time 0\n"
        "- Titles should be short (2-5 words)\n"
        "- Times must be integers in ascending order\n"
        "- 4-8 chapters total"
    )

    try:
        raw = await call_llm(prompt)
        chapters = _extract_json(raw)

        if not chapters or not isinstance(chapters, list):
            log.warning(f"content_pipeline: LLM returned no valid chapters for {video_id}")
            return

        db_w = await get_write_db()
        for i, ch in enumerate(chapters):
            if not isinstance(ch, dict) or "title" not in ch:
                continue
            start_time = int(ch.get("start_time", 0))
            await db_w.execute(
                """
                INSERT INTO video_chapters (video_id, title, start_time, sort_order)
                VALUES ($1, $2, $3, $4)
                """,
                video_id,
                str(ch["title"])[:100],
                start_time,
                i,
            )
        log.info(f"content_pipeline: {len(chapters)} chapters generated for {video_id}")
    except Exception as e:
        log.error(f"content_pipeline: chapters generation failed for {video_id}: {e}")


# ── Video pipeline ─────────────────────────────────────────────────────────────

async def process_video(video_id: str, include_transcript: bool = False) -> None:
    """
    Run LLM summarisation (and optionally transcription) for a video.
    Updates ai_summary, ai_topics, ai_tags, ai_status on the video row.
    """
    db_r = await get_read_db()
    row = await db_r.fetchrow(
        "SELECT id, title, description, category, duration_s FROM videos WHERE id = $1",
        video_id,
    )
    if not row:
        log.warning(f"content_pipeline: video {video_id} not found")
        return

    db_w = await get_write_db()
    await db_w.execute(
        "UPDATE videos SET ai_status = 'processing' WHERE id = $1", video_id
    )

    try:
        transcript: str | None = None

        if include_transcript:
            log.info(f"content_pipeline: transcribing video {video_id}")
            transcript = await transcribe_video(video_id)
            if transcript:
                await db_w.execute(
                    """
                    INSERT INTO video_transcripts (video_id, transcript, provider)
                    VALUES ($1, $2, $3)
                    ON CONFLICT (video_id) DO UPDATE
                        SET transcript = EXCLUDED.transcript,
                            provider   = EXCLUDED.provider,
                            created_at = now()
                    """,
                    video_id,
                    transcript,
                    "openai-whisper" if len(transcript) > 100 else "whisper",
                )
                log.info(f"content_pipeline: transcript saved for {video_id} ({len(transcript)} chars)")

                # Generate how-to guide and chapters from transcript (concurrent)
                await asyncio.gather(
                    generate_howto(video_id, row["title"], transcript),
                    generate_chapters(video_id, row["title"], transcript, row["duration_s"]),
                    return_exceptions=True,
                )
            else:
                log.info(f"content_pipeline: no transcript available for {video_id}")

        log.info(f"content_pipeline: summarising video {video_id}")
        result = await summarize_video(
            title=row["title"],
            description=row["description"],
            transcript=transcript,
            category=row["category"],
        )

        await db_w.execute(
            """
            UPDATE videos
               SET ai_summary      = $1,
                   ai_topics       = $2,
                   ai_tags         = $3,
                   ai_status       = 'done',
                   ai_processed_at = now()
             WHERE id = $4
            """,
            result["summary"] or None,
            result["topics"] or None,
            result["tags"] or None,
            video_id,
        )
        log.info(f"content_pipeline: video {video_id} processed successfully")

    except Exception as e:
        log.error(f"content_pipeline: video {video_id} failed: {e}")
        try:
            await db_w.execute(
                "UPDATE videos SET ai_status = 'error' WHERE id = $1", video_id
            )
        except Exception:
            pass


async def transcribe_and_update(video_id: str) -> None:
    """
    Transcribe video audio, then re-run summarisation + howto + chapters.
    Called after a video file is uploaded.
    """
    await process_video(video_id, include_transcript=True)


# ── Article pipeline ───────────────────────────────────────────────────────────

async def process_article(article_id: str) -> None:
    """
    Run LLM summarisation for an article.
    Updates ai_summary, ai_topics, ai_tags, ai_status on the article row.
    """
    db_r = await get_read_db()
    row = await db_r.fetchrow(
        "SELECT id, title, content, category FROM articles WHERE id = $1",
        article_id,
    )
    if not row:
        log.warning(f"content_pipeline: article {article_id} not found")
        return

    if not row["content"] or len(row["content"].strip()) < 50:
        log.info(f"content_pipeline: skipping article {article_id} — too little content")
        return

    db_w = await get_write_db()
    await db_w.execute(
        "UPDATE articles SET ai_status = 'processing' WHERE id = $1", article_id
    )

    try:
        log.info(f"content_pipeline: summarising article {article_id}")
        result = await summarize_article(
            title=row["title"],
            content=row["content"],
            category=row["category"],
        )

        await db_w.execute(
            """
            UPDATE articles
               SET ai_summary      = $1,
                   ai_topics       = $2,
                   ai_tags         = $3,
                   ai_status       = 'done',
                   ai_processed_at = now()
             WHERE id = $4
            """,
            result["summary"] or None,
            result["topics"] or None,
            result["tags"] or None,
            article_id,
        )
        log.info(f"content_pipeline: article {article_id} processed successfully")

    except Exception as e:
        log.error(f"content_pipeline: article {article_id} failed: {e}")
        try:
            await db_w.execute(
                "UPDATE articles SET ai_status = 'error' WHERE id = $1", article_id
            )
        except Exception:
            pass
