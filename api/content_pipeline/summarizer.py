"""
LLM-based summarisation, topic extraction, and tagging for videos and articles.
"""
from __future__ import annotations

import json
import re
from loguru import logger as log

from articles.llm import call_llm


def _extract_json(text: str) -> dict:
    """Parse JSON from LLM response, stripping any surrounding prose."""
    text = text.strip()
    # Try direct parse first
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    # Try to find a JSON block in the text
    match = re.search(r'\{[\s\S]*\}', text)
    if match:
        try:
            return json.loads(match.group())
        except json.JSONDecodeError:
            pass
    return {}


async def summarize_video(
    title: str,
    description: str | None,
    transcript: str | None = None,
    category: str | None = None,
) -> dict:
    """
    Generate AI summary, topics, and tags for a video.
    Returns: {"summary": str, "topics": list[str], "tags": list[str]}
    """
    context_parts = [f"Title: {title}"]
    if category:
        context_parts.append(f"Category: {category}")
    if description:
        context_parts.append(f"Description: {description}")
    if transcript:
        # Limit transcript to first 3000 chars to avoid token overflow
        context_parts.append(f"Transcript (excerpt): {transcript[:3000]}")

    context = "\n".join(context_parts)

    prompt = f"""You are an AI assistant that analyses educational video content for a learning portal.

Content:
{context}

Respond with ONLY a valid JSON object (no explanation, no markdown), structured exactly like this:
{{
  "summary": "A concise 2-3 sentence summary of what this video covers and what learners will gain.",
  "topics": ["topic1", "topic2", "topic3"],
  "tags": ["tag1", "tag2", "tag3", "tag4", "tag5"]
}}

Rules:
- summary: 2-3 sentences, plain English, suitable for a course catalogue
- topics: 3-6 key technical or conceptual topics covered (short phrases)
- tags: 4-8 single-word or short tags useful for search and discovery
"""

    try:
        raw = await call_llm(prompt)
        result = _extract_json(raw)
        return {
            "summary": result.get("summary", ""),
            "topics": result.get("topics", []) if isinstance(result.get("topics"), list) else [],
            "tags": result.get("tags", []) if isinstance(result.get("tags"), list) else [],
        }
    except Exception as e:
        log.error(f"content_pipeline summarize_video error: {e}")
        return {"summary": "", "topics": [], "tags": []}


async def summarize_article(
    title: str,
    content: str,
    category: str | None = None,
) -> dict:
    """
    Generate AI summary, topics, and tags for an article.
    Returns: {"summary": str, "topics": list[str], "tags": list[str]}
    """
    context_parts = [f"Title: {title}"]
    if category:
        context_parts.append(f"Category: {category}")
    # Limit content to first 4000 chars
    context_parts.append(f"Content: {content[:4000]}")

    context = "\n".join(context_parts)

    prompt = f"""You are an AI assistant that analyses educational articles for a learning portal.

Content:
{context}

Respond with ONLY a valid JSON object (no explanation, no markdown), structured exactly like this:
{{
  "summary": "A concise 2-3 sentence summary of the article's key insights.",
  "topics": ["topic1", "topic2", "topic3"],
  "tags": ["tag1", "tag2", "tag3", "tag4", "tag5"]
}}

Rules:
- summary: 2-3 sentences, clear and informative, suitable for a content catalogue
- topics: 3-6 key themes or concepts covered (short phrases)
- tags: 4-8 single-word or short tags useful for search
"""

    try:
        raw = await call_llm(prompt)
        result = _extract_json(raw)
        return {
            "summary": result.get("summary", ""),
            "topics": result.get("topics", []) if isinstance(result.get("topics"), list) else [],
            "tags": result.get("tags", []) if isinstance(result.get("tags"), list) else [],
        }
    except Exception as e:
        log.error(f"content_pipeline summarize_article error: {e}")
        return {"summary": "", "topics": [], "tags": []}
