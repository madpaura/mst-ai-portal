"""Tests for user profile & info tools (issue #110)."""
import asyncio
from unittest.mock import patch, AsyncMock, MagicMock


def _run(coro):
    return asyncio.run(coro)


def _make_db(rows=None, row=None, val=None):
    db = MagicMock()
    db.fetch = AsyncMock(return_value=rows or [])
    db.fetchrow = AsyncMock(return_value=row)
    db.fetchval = AsyncMock(return_value=val)
    return db


# ── get_video_details ─────────────────────────────────────────────────────────

class TestGetVideoDetails:
    def test_returns_video_detail(self):
        from assistant.tools import get_video_details
        row = MagicMock()
        row.__getitem__ = lambda s, k: {
            "id": "v1", "title": "Intro to LLMs", "slug": "intro-llms",
            "description": "Learn LLMs", "category": "ai", "is_published": True,
        }[k]
        db = _make_db(row=row, rows=[])
        with patch("assistant.tools.get_db", AsyncMock(return_value=db)):
            result = _run(get_video_details("intro-llms", user_id="u1", user_role="user"))
        assert result["found"] is True
        assert result["title"] == "Intro to LLMs"
        assert "/ignite/" in result["url"]

    def test_not_found_returns_found_false(self):
        from assistant.tools import get_video_details
        db = _make_db(row=None)
        with patch("assistant.tools.get_db", AsyncMock(return_value=db)):
            result = _run(get_video_details("no-such-slug", user_id="u1", user_role="user"))
        assert result["found"] is False


# ── get_video_transcript ──────────────────────────────────────────────────────

class TestGetVideoTranscript:
    def test_returns_transcript_text_from_file(self, tmp_path):
        from assistant.tools import get_video_transcript
        import json, os

        # Mock the DB to return a video id
        row = MagicMock()
        row.__getitem__ = lambda s, k: {"id": "abc123", "title": "Test"}[k]
        db = _make_db(row=row)

        # Create a fake transcript file
        t_dir = tmp_path / "abc123"
        t_dir.mkdir()
        t_file = t_dir / "transcript.json"
        t_file.write_text(json.dumps([{"text": "Hello world", "start": 0}]))

        with patch("assistant.tools.get_db", AsyncMock(return_value=db)):
            with patch("assistant.tools.settings") as mock_settings:
                mock_settings.VIDEO_STORAGE_PATH = str(tmp_path)
                result = _run(get_video_transcript("test", user_id="u1", user_role="user"))

        assert result["found"] is True
        assert "Hello world" in result["transcript"]

    def test_no_transcript_file_returns_not_found(self, tmp_path):
        from assistant.tools import get_video_transcript
        row = MagicMock()
        row.__getitem__ = lambda s, k: {"id": "no-transcript", "title": "Test"}[k]
        db = _make_db(row=row)

        with patch("assistant.tools.get_db", AsyncMock(return_value=db)):
            with patch("assistant.tools.settings") as mock_settings:
                mock_settings.VIDEO_STORAGE_PATH = str(tmp_path)
                result = _run(get_video_transcript("test", user_id="u1", user_role="user"))

        assert result["found"] is False

    def test_video_not_in_db_returns_not_found(self):
        from assistant.tools import get_video_transcript
        db = _make_db(row=None)
        with patch("assistant.tools.get_db", AsyncMock(return_value=db)):
            result = _run(get_video_transcript("ghost-slug", user_id="u1", user_role="user"))
        assert result["found"] is False


# ── get_my_learning_progress ──────────────────────────────────────────────────

class TestGetMyLearningProgress:
    def test_returns_progress_rows(self):
        from assistant.tools import get_my_learning_progress
        row = MagicMock()
        row.__getitem__ = lambda s, k: {
            "title": "LLM Basics", "slug": "llm-basics",
            "completed": False, "watched_seconds": 540,
        }[k]
        db = _make_db(rows=[row])
        with patch("assistant.tools.get_db", AsyncMock(return_value=db)):
            result = _run(get_my_learning_progress(user_id="u1", user_role="user"))
        assert result["found"] is True
        assert len(result["progress"]) == 1
        assert result["progress"][0]["title"] == "LLM Basics"

    def test_empty_returns_found_false(self):
        from assistant.tools import get_my_learning_progress
        db = _make_db(rows=[])
        with patch("assistant.tools.get_db", AsyncMock(return_value=db)):
            result = _run(get_my_learning_progress(user_id="u1", user_role="user"))
        assert result["found"] is False


# ── get_course_progress ───────────────────────────────────────────────────────

class TestGetCourseProgress:
    def test_returns_course_progress(self):
        from assistant.tools import get_course_progress
        course_row = MagicMock()
        course_row.__getitem__ = lambda s, k: {
            "id": "c1", "title": "AI Bootcamp",
        }[k]
        video_row = MagicMock()
        video_row.__getitem__ = lambda s, k: {
            "title": "Module 1", "slug": "module-1", "completed": True,
        }[k]
        db = MagicMock()
        db.fetchrow = AsyncMock(return_value=course_row)
        db.fetch = AsyncMock(return_value=[video_row])
        with patch("assistant.tools.get_db", AsyncMock(return_value=db)):
            result = _run(get_course_progress("ai-bootcamp", user_id="u1", user_role="user"))
        assert result["found"] is True
        assert result["course_title"] == "AI Bootcamp"
        assert len(result["videos"]) == 1

    def test_course_not_found(self):
        from assistant.tools import get_course_progress
        db = _make_db(row=None)
        with patch("assistant.tools.get_db", AsyncMock(return_value=db)):
            result = _run(get_course_progress("no-course", user_id="u1", user_role="user"))
        assert result["found"] is False


# ── get_my_notes ──────────────────────────────────────────────────────────────

class TestGetMyNotes:
    def test_returns_notes(self):
        from assistant.tools import get_my_notes
        row = MagicMock()
        row.__getitem__ = lambda s, k: {
            "video_title": "LLM Basics",
            "content": "Key insight here", "timestamp_s": 30,
        }[k]
        db = _make_db(rows=[row])
        with patch("assistant.tools.get_db", AsyncMock(return_value=db)):
            result = _run(get_my_notes(user_id="u1", user_role="user"))
        assert result["found"] is True
        assert result["notes"][0]["content"] == "Key insight here"

    def test_no_notes_returns_found_false(self):
        from assistant.tools import get_my_notes
        db = _make_db(rows=[])
        with patch("assistant.tools.get_db", AsyncMock(return_value=db)):
            result = _run(get_my_notes(user_id="u1", user_role="user"))
        assert result["found"] is False


# ── get_announcements ─────────────────────────────────────────────────────────

class TestGetAnnouncements:
    def test_returns_announcements(self):
        from assistant.tools import get_announcements
        row = MagicMock()
        row.__getitem__ = lambda s, k: {
            "title": "New Feature Launch", "content": "We launched X",
            "created_at": "2025-01-15",
        }[k]
        db = _make_db(rows=[row])
        with patch("assistant.tools.get_db", AsyncMock(return_value=db)):
            result = _run(get_announcements(user_id="u1", user_role="user"))
        assert result["found"] is True
        assert result["announcements"][0]["title"] == "New Feature Launch"

    def test_empty_returns_found_false(self):
        from assistant.tools import get_announcements
        db = _make_db(rows=[])
        with patch("assistant.tools.get_db", AsyncMock(return_value=db)):
            result = _run(get_announcements(user_id="u1", user_role="user"))
        assert result["found"] is False


# ── get_ai_news ───────────────────────────────────────────────────────────────

class TestGetAiNews:
    def test_returns_news_items(self):
        from assistant.tools import get_ai_news
        row = MagicMock()
        row.__getitem__ = lambda s, k: {
            "title": "GPT-5 Released", "source_url": "https://example.com/gpt5",
            "summary": "OpenAI releases GPT-5", "published_at": "2025-01-10",
        }[k]
        db = _make_db(rows=[row])
        with patch("assistant.tools.get_db", AsyncMock(return_value=db)):
            result = _run(get_ai_news(user_id="u1", user_role="user"))
        assert result["found"] is True
        assert result["news"][0]["title"] == "GPT-5 Released"

    def test_empty_returns_found_false(self):
        from assistant.tools import get_ai_news
        db = _make_db(rows=[])
        with patch("assistant.tools.get_db", AsyncMock(return_value=db)):
            result = _run(get_ai_news(user_id="u1", user_role="user"))
        assert result["found"] is False


# ── get_forge_component_instructions ─────────────────────────────────────────

class TestGetForgeComponentInstructions:
    def test_returns_install_instructions(self):
        from assistant.tools import get_forge_component_instructions
        row = MagicMock()
        row.__getitem__ = lambda s, k: {
            "name": "Summariser", "slug": "summariser", "component_type": "skill",
            "install_command": "claude install summariser",
            "long_description": "", "howto_guide": "Run the install command above.",
        }[k]
        row.get = lambda k, d=None: {
            "long_description": "", "howto_guide": "Run the install command above.",
        }.get(k, d)
        db = _make_db(row=row)
        with patch("assistant.tools.get_db", AsyncMock(return_value=db)):
            result = _run(get_forge_component_instructions("summariser", user_id="u1", user_role="user"))
        assert result["found"] is True
        assert result["install_command"] == "claude install summariser"
        assert result["name"] == "Summariser"

    def test_not_found(self):
        from assistant.tools import get_forge_component_instructions
        db = _make_db(row=None)
        with patch("assistant.tools.get_db", AsyncMock(return_value=db)):
            result = _run(get_forge_component_instructions("no-slug", user_id="u1", user_role="user"))
        assert result["found"] is False
