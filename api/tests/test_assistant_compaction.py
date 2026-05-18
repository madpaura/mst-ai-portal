"""Tests for conversation compaction endpoint (issue #112)."""
import json
import asyncio
from unittest.mock import patch, AsyncMock


def _run(coro):
    return asyncio.run(coro)


async def _collect(gen) -> list[str]:
    items = []
    async for chunk in gen:
        items.append(chunk)
    return items


def _parse_sse(chunk: str) -> dict:
    assert chunk.startswith("data: "), f"expected SSE prefix, got: {chunk!r}"
    return json.loads(chunk[len("data: "):])


# ── POST /assistant/compact ───────────────────────────────────────────────────

class TestCompactRoute:
    def test_compact_route_exists(self):
        from assistant.router import router
        paths = [r.path for r in router.routes]
        assert "/compact" in paths

    def test_compact_route_requires_auth(self):
        from assistant.router import router
        from auth.dependencies import get_current_user
        route = next(r for r in router.routes if r.path == "/compact")
        dep_calls = [d.call for d in route.dependant.dependencies]
        assert get_current_user in dep_calls

    def test_compact_returns_summary(self):
        from assistant.router import compact

        async def mock_llm(*_args, **_kwargs):
            from assistant.llm import LLMResponse
            return LLMResponse(text="User asked about Python videos. Found 3 results.", tool_calls=[])

        messages = [
            {"role": "user", "content": "find python videos"},
            {"role": "assistant", "content": "I found 3 Python videos for you."},
        ] * 5  # 10 messages

        with patch("assistant.router.call_llm_with_tools", mock_llm):
            result = _run(compact(
                messages=messages,
                user={"id": "u1", "role": "user"},
            ))

        assert "summary" in result
        assert len(result["summary"]) > 0

    def test_compact_with_empty_messages_returns_empty_summary(self):
        from assistant.router import compact

        result = _run(compact(messages=[], user={"id": "u1", "role": "user"}))
        assert result["summary"] == ""


# ── _generate passes page context tool_start info ────────────────────────────

class TestGenerateWithToolStart:
    def test_tool_start_event_includes_display_message(self):
        from assistant.router import _generate
        from assistant.llm import LLMResponse, ToolCall

        call_count = 0

        async def mock_llm(*_args, **_kwargs):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                return LLMResponse(
                    text=None,
                    tool_calls=[ToolCall(id="tc1", name="search_videos", arguments={"query": "python"})]
                )
            return LLMResponse(text="Found some videos!", tool_calls=[])

        async def mock_dispatch(name, args, user):
            return {"found": True, "results": []}

        with patch("assistant.router.call_llm_with_tools", mock_llm):
            with patch("assistant.router._dispatch_tool", mock_dispatch):
                chunks = _run(_collect(_generate([], {}, {})))

        events = [_parse_sse(c) for c in chunks]
        tool_starts = [e for e in events if e["type"] == "tool_start"]
        assert len(tool_starts) == 1
        assert tool_starts[0]["name"] == "search_videos"
        assert "message" in tool_starts[0]
