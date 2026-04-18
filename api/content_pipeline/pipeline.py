"""
Orchestrates the content pipeline for videos and articles.

Usage:
    asyncio.create_task(process_video(video_id))
    asyncio.create_task(process_article(article_id))
    asyncio.create_task(transcribe_and_update(video_id))   # after file upload
"""
from __future__ import annotations

import asyncio
from loguru import logger as log

from database import get_write_db, get_read_db
from .summarizer import summarize_video, summarize_article
from .transcriber import transcribe_video


async def process_video(video_id: str, include_transcript: bool = False) -> None:
    """
    Run LLM summarisation (and optionally transcription) for a video.
    Updates ai_summary, ai_topics, ai_tags, ai_status on the video row.
    """
    db_r = await get_read_db()
    row = await db_r.fetchrow(
        "SELECT id, title, description, category FROM videos WHERE id = $1",
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
    Transcribe video audio, then re-run summarisation with the transcript.
    Called after a video file is uploaded.
    """
    await process_video(video_id, include_transcript=True)


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
