"""
WebVTT helpers for the content pipeline.

- generate_vtt_from_text(): approximate VTT from plain text + duration
- whisper_json_to_vtt(): accurate VTT from Whisper verbose_json segments
"""
from __future__ import annotations


def _fmt_time(seconds: float) -> str:
    """Format seconds as WebVTT timestamp: HH:MM:SS.mmm"""
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = seconds % 60
    return f"{h:02d}:{m:02d}:{s:06.3f}"


def generate_vtt_from_text(text: str, duration_s: int | None, words_per_minute: int = 130) -> str:
    """
    Generate an approximate WebVTT from plain text when timestamps aren't available.
    Distributes words evenly across the video duration.
    """
    words = text.split()
    if not words:
        return "WEBVTT\n\n"

    total = float(duration_s) if duration_s and duration_s > 0 else (len(words) / words_per_minute) * 60.0

    # ~15 words per cue ≈ 7 seconds at average speaking rate
    chunk_size = 15
    lines = ["WEBVTT", ""]
    cue_num = 1

    for i in range(0, len(words), chunk_size):
        chunk = words[i : i + chunk_size]
        start = (i / len(words)) * total
        end = ((i + len(chunk)) / len(words)) * total
        lines += [str(cue_num), f"{_fmt_time(start)} --> {_fmt_time(end)}", " ".join(chunk), ""]
        cue_num += 1

    return "\n".join(lines)


def whisper_json_to_vtt(segments: list[dict]) -> str:
    """
    Convert Whisper verbose_json segments (each with 'start', 'end', 'text') to WebVTT.
    This produces accurate caption timing.
    """
    lines = ["WEBVTT", ""]
    for i, seg in enumerate(segments, 1):
        start = float(seg.get("start", 0))
        end = float(seg.get("end", start + 3))
        text = str(seg.get("text", "")).strip()
        if not text:
            continue
        lines += [str(i), f"{_fmt_time(start)} --> {_fmt_time(end)}", text, ""]
    return "\n".join(lines)
