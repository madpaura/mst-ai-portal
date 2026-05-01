"""
LLM prompts for auto-mode video processing.
All prompts return strict JSON; call parse_json_strict() on the response.
"""
import json
import re
from typing import Any


def parse_json_strict(text: str) -> Any:
    """Strip markdown fences and parse JSON; raise ValueError on failure."""
    text = text.strip()
    # Strip ```json ... ``` or ``` ... ``` wrappers
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text.strip())
    return json.loads(text.strip())


def _truncate_transcript(full_text: str, max_chars: int = 20000) -> str:
    """Keep first 60% + last 40% if transcript is too long for the LLM context."""
    if len(full_text) <= max_chars:
        return full_text
    keep_start = int(max_chars * 0.6)
    keep_end = int(max_chars * 0.4)
    return full_text[:keep_start] + "\n\n[...middle truncated...]\n\n" + full_text[-keep_end:]


def _segments_to_text(segments: list[dict]) -> str:
    """Format transcript segments with timestamps for chapter prompt."""
    lines = []
    for s in segments:
        start = int(s.get("start", 0))
        lines.append(f"[{start}s] {s.get('text', '').strip()}")
    return "\n".join(lines)


def metadata_prompt(transcript_text: str, video_title: str = "") -> str:
    truncated = _truncate_transcript(transcript_text)
    return f"""You are summarizing a technical training video for a corporate learning portal.

{"Current title: " + video_title if video_title else ""}

Transcript:
{truncated}

Return ONLY the following JSON object, no prose, no markdown:
{{
  "title": "concise descriptive title, max 70 chars",
  "description": "2-3 sentence plain-text summary of what the viewer will learn",
  "category": "one of: AI, Cloud, DevOps, Security, Frontend, Backend, Data, Other"
}}"""


def chapters_prompt(segments: list[dict]) -> str:
    segments_text = _segments_to_text(segments)
    return f"""Identify 4-10 chapter break points in this video transcript. Pick natural topic shifts where the speaker starts a new concept.

Transcript with timestamps (seconds):
{segments_text}

Return ONLY a JSON array, no prose, no markdown:
[
  {{"title": "Introduction", "start_time": 0}},
  {{"title": "Setting up the environment", "start_time": 45}},
  ...
]

Rules:
- start_time is an integer (seconds).
- First chapter must have start_time = 0.
- Titles are max 60 chars, no episode or chapter number prefix.
- Choose real topic transitions, not arbitrary intervals."""


def howto_prompt(transcript_text: str, video_title: str = "") -> str:
    truncated = _truncate_transcript(transcript_text)
    return f"""Write a how-to guide based on this video transcript. The guide should be practical and actionable.

{"Video: " + video_title if video_title else ""}

Transcript:
{truncated}

Return ONLY the following JSON object, no prose, no markdown:
{{
  "title": "How to ... (max 70 chars)",
  "content": "## Prerequisites\\n\\n...\\n\\n## Step 1: ...\\n\\n## Step 2: ...\\n\\n## Conclusion\\n\\n..."
}}

The content field must be a valid markdown string. Use ## headings, bullet lists, and code blocks where appropriate."""
