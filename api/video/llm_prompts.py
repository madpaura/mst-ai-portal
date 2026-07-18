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


def chapters_prompt(segments: list[dict], duration: float | None = None) -> str:
    segments_text = _segments_to_text(segments)
    duration_line = f"Total video duration: {int(duration)}s ({int(duration)//60}m {int(duration)%60}s)\n" if duration else ""
    # Tell the LLM the number of windows it should aim for so chapters cover the full video
    target = min(10, max(4, int(duration / 300) + 1)) if duration else 7  # ~one chapter per 5 min
    return f"""Identify {target}-10 chapter break points in this video transcript. Chapters MUST be evenly spread across the FULL duration — do not cluster them in the first half.

{duration_line}Transcript with timestamps (seconds):
{segments_text}

Return ONLY a JSON array, no prose, no markdown:
[
  {{"title": "Introduction", "start_time": 0}},
  {{"title": "Setting up the environment", "start_time": 45}},
  ...
]

Rules:
- Exactly {target} to 10 chapters total. Never fewer than {target}, never more than 10.
- start_time is an integer (seconds). First chapter MUST be start_time = 0.
- The LAST chapter must start within the final 25% of the video (after {int(duration * 0.75) if duration else "the 75% mark"}s).
- Divide the video into {target} roughly equal time windows; find the strongest topic shift inside each window.
- Titles are max 60 chars, sentence-case, no episode/chapter number prefix.
- Prefer real topic transitions over arbitrary intervals — but coverage of the full duration is required."""


# ── Editor LLM skippable-span suggestions (issue #262) ──────────────────────
#
# Second suggestion source for the non-destructive video editor, alongside the
# deterministic silence-gap pass (issue #259). Runs over compacted transcript
# segments (start/end rounded to 0.1s to keep the prompt small) and asks the
# LLM to flag spans a human editor would cut: screen-share/setup housekeeping,
# false starts, dead air, off-topic chatter. Chunked by the caller
# (`chunk_transcript_segments`) when the transcript is too long for one call;
# each chunk's spans are merged by the caller since chunk segments carry
# absolute (not chunk-relative) timestamps.

def compact_transcript_segments(segments: list[dict]) -> list[dict]:
    """Round transcript segment timestamps to 0.1s and strip to {start, end, text}."""
    out: list[dict] = []
    for s in segments:
        start, end = s.get("start"), s.get("end")
        if start is None or end is None:
            continue
        out.append({
            "start": round(float(start), 1),
            "end": round(float(end), 1),
            "text": (s.get("text") or "").strip(),
        })
    return out


def chunk_transcript_segments(compact: list[dict], max_chars: int = 12000) -> list[list[dict]]:
    """Group compacted segments into chunks under a character budget so the
    prompt fits the model's context window. Chunks preserve absolute
    timestamps, so results from each chunk merge without offset math."""
    chunks: list[list[dict]] = []
    cur: list[dict] = []
    cur_len = 0
    for s in compact:
        line_len = len(s["text"]) + 24  # rough allowance for the "[Ns–Ms] " prefix
        if cur and cur_len + line_len > max_chars:
            chunks.append(cur)
            cur, cur_len = [], 0
        cur.append(s)
        cur_len += line_len
    if cur:
        chunks.append(cur)
    return chunks or [[]]


def _compact_segments_to_text(chunk: list[dict]) -> str:
    return "\n".join(f"[{s['start']}s–{s['end']}s] {s['text']}" for s in chunk)


def editor_llm_suggestions_prompt(chunk: list[dict], duration: float | None = None) -> str:
    segments_text = _compact_segments_to_text(chunk)
    duration_line = f"Total video duration: {duration:.1f}s\n" if duration else ""
    return f"""You are helping a video editor find low-value spans in a recorded video that a human editor would cut out.

{duration_line}Timestamped transcript segments (seconds, rounded to 0.1s):
{segments_text}

Flag spans that are:
- Screen-share / setup housekeeping ("let me share my screen", "can everyone see this", "one sec while I...")
- False starts or restarts (the speaker restarts a sentence or explanation from scratch)
- Dead air / waiting (silence, waiting for latecomers, waiting for questions)
- Off-topic chatter unrelated to the subject matter

Do NOT flag substantive technical content, even if it feels slow-paced or repetitive for teaching purposes.

Return ONLY the following JSON object, no prose, no markdown:
{{
  "spans": [
    {{"start_s": 12.3, "end_s": 18.0, "reason": "short human-readable why, max 80 chars"}}
  ]
}}

If nothing in this transcript is worth cutting, return {{"spans": []}}."""


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
