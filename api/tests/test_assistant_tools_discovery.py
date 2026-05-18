"""Tests for discovery & content search tools (issue #109)."""
import asyncio
from unittest.mock import patch, AsyncMock, MagicMock


def _run(coro):
    return asyncio.run(coro)


def _make_db(rows=None, row=None, val=None):
    """Return a mock asyncpg connection that returns given data."""
    db = MagicMock()
    db.fetch = AsyncMock(return_value=rows or [])
    db.fetchrow = AsyncMock(return_value=row)
    db.fetchval = AsyncMock(return_value=val)
    return db


# ── Tool registry / role gating ───────────────────────────────────────────────

class TestToolRegistry:
    def test_get_tools_for_user_role_returns_15_schemas(self):
        from assistant.tools import get_tools_for_role
        tools = get_tools_for_role("user")
        assert len(tools) == 15
        names = {t["function"]["name"] for t in tools}
        assert "search_videos" in names
        assert "global_search" in names
        # content-only tools must NOT appear
        assert "get_my_articles" not in names
        assert "get_video_job_status" not in names

    def test_get_tools_for_content_role_returns_21_schemas(self):
        from assistant.tools import get_tools_for_role
        tools = get_tools_for_role("content")
        assert len(tools) == 21
        names = {t["function"]["name"] for t in tools}
        assert "get_my_articles" in names
        assert "get_video_job_status" in names

    def test_get_tools_for_admin_role_returns_21_schemas(self):
        from assistant.tools import get_tools_for_role
        tools = get_tools_for_role("admin")
        assert len(tools) == 21

    def test_tool_schemas_are_openai_function_format(self):
        from assistant.tools import get_tools_for_role
        tools = get_tools_for_role("user")
        for t in tools:
            assert t["type"] == "function"
            assert "name" in t["function"]
            assert "description" in t["function"]
            assert "parameters" in t["function"]

    def test_dispatch_unknown_tool_returns_error(self):
        from assistant.tools import dispatch_tool
        result = _run(dispatch_tool("nonexistent_tool", {}, {"id": "u1", "role": "user"}))
        assert "error" in result


# ── search_videos ─────────────────────────────────────────────────────────────

class TestSearchVideos:
    def _row(self, title="Python Basics", slug="python-basics", category="ai"):
        r = MagicMock()
        r.__getitem__ = lambda s, k: {
            "title": title, "slug": slug, "category": category,
            "description": "A video about " + title,
            "thumbnail": None,
        }[k]
        return r

    def test_returns_results_for_matching_query(self):
        from assistant.tools import search_videos
        row = self._row()
        db = _make_db(rows=[row])
        with patch("assistant.tools.get_db", AsyncMock(return_value=db)):
            result = _run(search_videos("python", user_id="u1", user_role="user"))
        assert result["found"] is True
        assert len(result["results"]) == 1
        assert result["results"][0]["slug"] == "python-basics"
        assert "/ignite/" in result["results"][0]["url"]

    def test_returns_not_found_for_no_rows(self):
        from assistant.tools import search_videos
        db = _make_db(rows=[])
        with patch("assistant.tools.get_db", AsyncMock(return_value=db)):
            result = _run(search_videos("xyz_no_match", user_id="u1", user_role="user"))
        assert result["found"] is False


# ── list_courses ──────────────────────────────────────────────────────────────

class TestListCourses:
    def test_returns_course_list(self):
        from assistant.tools import list_courses
        row = MagicMock()
        row.__getitem__ = lambda s, k: {
            "title": "LLM Foundations", "slug": "llm-foundations",
            "description": "Learn LLMs", "video_count": 5,
        }[k]
        db = _make_db(rows=[row])
        with patch("assistant.tools.get_db", AsyncMock(return_value=db)):
            result = _run(list_courses(user_id="u1", user_role="user"))
        assert result["found"] is True
        assert result["courses"][0]["title"] == "LLM Foundations"


# ── search_articles ───────────────────────────────────────────────────────────

class TestSearchArticles:
    def test_returns_article_results(self):
        from assistant.tools import search_articles
        row = MagicMock()
        row.__getitem__ = lambda s, k: {
            "title": "RAG Guide", "slug": "rag-guide",
            "summary": "About RAG", "category": "ai",
        }[k]
        db = _make_db(rows=[row])
        with patch("assistant.tools.get_db", AsyncMock(return_value=db)):
            result = _run(search_articles("RAG", user_id="u1", user_role="user"))
        assert result["found"] is True
        assert "/articles/" in result["results"][0]["url"]

    def test_not_found_returns_found_false(self):
        from assistant.tools import search_articles
        db = _make_db(rows=[])
        with patch("assistant.tools.get_db", AsyncMock(return_value=db)):
            result = _run(search_articles("xyz", user_id="u1", user_role="user"))
        assert result["found"] is False


# ── search_solutions ──────────────────────────────────────────────────────────

class TestSearchSolutions:
    def test_returns_solutions(self):
        from assistant.tools import search_solutions
        row = MagicMock()
        row.__getitem__ = lambda s, k: {
            "title": "AI Copilot", "subtitle": "Productivity", "description": "An AI tool", "category": "SW",
        }[k]
        db = _make_db(rows=[row])
        with patch("assistant.tools.get_db", AsyncMock(return_value=db)):
            result = _run(search_solutions("copilot", user_id="u1", user_role="user"))
        assert result["found"] is True


# ── search_forge_components ───────────────────────────────────────────────────

class TestSearchForgeComponents:
    def test_returns_components(self):
        from assistant.tools import search_forge_components
        row = MagicMock()
        row.__getitem__ = lambda s, k: {
            "name": "Summariser", "slug": "summariser", "component_type": "skill",
            "description": "Summarises text", "install_command": "claude install summariser",
        }[k]
        db = _make_db(rows=[row])
        with patch("assistant.tools.get_db", AsyncMock(return_value=db)):
            result = _run(search_forge_components("summariser", user_id="u1", user_role="user"))
        assert result["found"] is True
        assert result["results"][0]["install_command"] == "claude install summariser"


# ── get_forge_component ───────────────────────────────────────────────────────

class TestGetForgeComponent:
    def test_returns_component_detail(self):
        from assistant.tools import get_forge_component
        row = MagicMock()
        row.__getitem__ = lambda s, k: {
            "name": "Summariser", "slug": "summariser", "component_type": "skill",
            "description": "Summarises text", "version": "1.0",
            "install_command": "claude install summariser",
            "author": "admin", "tags": ["nlp"],
        }[k]
        db = _make_db(row=row)
        with patch("assistant.tools.get_db", AsyncMock(return_value=db)):
            result = _run(get_forge_component("summariser", user_id="u1", user_role="user"))
        assert result["found"] is True
        assert result["name"] == "Summariser"

    def test_not_found(self):
        from assistant.tools import get_forge_component
        db = _make_db(row=None)
        with patch("assistant.tools.get_db", AsyncMock(return_value=db)):
            result = _run(get_forge_component("no-such-slug", user_id="u1", user_role="user"))
        assert result["found"] is False


# ── global_search ─────────────────────────────────────────────────────────────

class TestGlobalSearch:
    def test_returns_mixed_results(self):
        from assistant.tools import global_search
        row = MagicMock()
        row.__getitem__ = lambda s, k: {
            "type": "video", "title": "Intro to LLMs", "description": "...",
            "url_key": "intro-to-llms", "thumbnail": None, "category": "ai",
        }[k]
        db = _make_db(rows=[row])
        with patch("assistant.tools.get_db", AsyncMock(return_value=db)):
            result = _run(global_search("LLMs", user_id="u1", user_role="user"))
        assert result["found"] is True
        assert len(result["results"]) >= 1
