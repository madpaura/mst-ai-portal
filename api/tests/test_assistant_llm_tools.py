"""Tests for multi-provider tool-call abstraction layer (issue #108)."""
import json
import asyncio
from unittest.mock import patch, AsyncMock


def _run(coro):
    return asyncio.run(coro)


# ── Provider response parsers ─────────────────────────────────────────────────

class TestParseOllamaResponse:
    FIXTURE_TOOL = {
        "message": {
            "role": "assistant",
            "content": "",
            "tool_calls": [{"function": {"name": "search_videos", "arguments": {"query": "python"}}}],
        },
        "done": True,
    }
    FIXTURE_TEXT = {
        "message": {"role": "assistant", "content": "Here are videos."},
        "done": True,
    }

    def test_tool_call_parsed(self):
        from assistant.llm import parse_ollama_response, ToolCall, LLMResponse
        result = parse_ollama_response(self.FIXTURE_TOOL)
        assert isinstance(result, LLMResponse)
        assert len(result.tool_calls) == 1
        tc = result.tool_calls[0]
        assert isinstance(tc, ToolCall)
        assert tc.name == "search_videos"
        assert tc.arguments == {"query": "python"}
        assert tc.id  # UUID generated

    def test_text_parsed(self):
        from assistant.llm import parse_ollama_response
        result = parse_ollama_response(self.FIXTURE_TEXT)
        assert result.text == "Here are videos."
        assert result.tool_calls == []


class TestParseOpenAIResponse:
    FIXTURE_TOOL = {
        "choices": [{"message": {
            "role": "assistant", "content": None,
            "tool_calls": [{
                "id": "call_abc",
                "type": "function",
                "function": {"name": "search_videos", "arguments": '{"query": "python"}'},
            }],
        }, "finish_reason": "tool_calls"}],
    }
    FIXTURE_TEXT = {
        "choices": [{"message": {"role": "assistant", "content": "Here are results."}, "finish_reason": "stop"}],
    }

    def test_tool_call_parsed_with_id_and_deserialized_args(self):
        from assistant.llm import parse_openai_response
        result = parse_openai_response(self.FIXTURE_TOOL)
        assert len(result.tool_calls) == 1
        tc = result.tool_calls[0]
        assert tc.id == "call_abc"
        assert tc.name == "search_videos"
        assert tc.arguments == {"query": "python"}  # JSON string → dict

    def test_text_parsed(self):
        from assistant.llm import parse_openai_response
        result = parse_openai_response(self.FIXTURE_TEXT)
        assert result.text == "Here are results."
        assert result.tool_calls == []


class TestParseAnthropicResponse:
    FIXTURE_TOOL = {
        "content": [{"type": "tool_use", "id": "toolu_abc", "name": "search_videos", "input": {"query": "python"}}],
        "stop_reason": "tool_use",
    }
    FIXTURE_TEXT = {
        "content": [{"type": "text", "text": "Here are results."}],
        "stop_reason": "end_turn",
    }

    def test_tool_use_parsed(self):
        from assistant.llm import parse_anthropic_response
        result = parse_anthropic_response(self.FIXTURE_TOOL)
        assert len(result.tool_calls) == 1
        tc = result.tool_calls[0]
        assert tc.id == "toolu_abc"
        assert tc.name == "search_videos"
        assert tc.arguments == {"query": "python"}

    def test_text_parsed(self):
        from assistant.llm import parse_anthropic_response
        result = parse_anthropic_response(self.FIXTURE_TEXT)
        assert result.text == "Here are results."
        assert result.tool_calls == []


# ── Schema + message converters ───────────────────────────────────────────────

class TestToAnthropicTools:
    OPENAI_TOOL = {
        "type": "function",
        "function": {
            "name": "search_videos",
            "description": "Search videos",
            "parameters": {"type": "object", "properties": {"query": {"type": "string"}}, "required": ["query"]},
        },
    }

    def test_parameters_becomes_input_schema(self):
        from assistant.llm import to_anthropic_tools
        result = to_anthropic_tools([self.OPENAI_TOOL])
        assert len(result) == 1
        t = result[0]
        assert t["name"] == "search_videos"
        assert t["description"] == "Search videos"
        assert "input_schema" in t
        assert t["input_schema"] == self.OPENAI_TOOL["function"]["parameters"]
        assert "parameters" not in t
        assert "type" not in t


class TestToAnthropicMessages:
    def test_tool_result_becomes_user_message_with_content_block(self):
        from assistant.llm import to_anthropic_messages
        msgs = [
            {"role": "user", "content": "hi"},
            {"role": "assistant", "content": None, "tool_calls": [
                {"id": "tc_1", "function": {"name": "search_videos", "arguments": {"q": "py"}}}
            ]},
            {"role": "tool", "tool_call_id": "tc_1", "tool_name": "search_videos", "content": '{"found":true}'},
        ]
        result = to_anthropic_messages(msgs)
        tool_msg = next(m for m in result if m["role"] == "user" and isinstance(m.get("content"), list))
        block = tool_msg["content"][0]
        assert block["type"] == "tool_result"
        assert block["tool_use_id"] == "tc_1"
        assert block["content"] == '{"found":true}'

    def test_assistant_tool_calls_become_tool_use_blocks(self):
        from assistant.llm import to_anthropic_messages
        msgs = [
            {"role": "assistant", "content": None, "tool_calls": [
                {"id": "tc_1", "function": {"name": "search_videos", "arguments": {"q": "py"}}}
            ]},
        ]
        result = to_anthropic_messages(msgs)
        asst = result[0]
        assert asst["role"] == "assistant"
        assert isinstance(asst["content"], list)
        block = asst["content"][0]
        assert block["type"] == "tool_use"
        assert block["id"] == "tc_1"
        assert block["name"] == "search_videos"
        assert block["input"] == {"q": "py"}

    def test_system_messages_dropped(self):
        from assistant.llm import to_anthropic_messages
        msgs = [
            {"role": "system", "content": "You are..."},
            {"role": "user", "content": "hi"},
        ]
        result = to_anthropic_messages(msgs)
        assert all(m["role"] != "system" for m in result)


# ── Agentic loop in _generate ─────────────────────────────────────────────────

def _collect(gen):
    async def _inner():
        items = []
        async for chunk in gen:
            items.append(chunk)
        return items
    return asyncio.run(_inner())


def _parse(chunk):
    assert chunk.startswith("data: ")
    return json.loads(chunk[6:])


class TestAgenticLoop:
    """_generate runs the tool call loop and emits correct SSE events."""

    def test_tool_call_emits_tool_start_then_final_tokens(self):
        from assistant.router import _generate
        from assistant.llm import LLMResponse, ToolCall

        call_count = [0]

        async def mock_llm(*args, **kwargs):
            call_count[0] += 1
            if call_count[0] == 1:
                return LLMResponse(text=None, tool_calls=[
                    ToolCall(id="tc_1", name="search_videos", arguments={"query": "python"})
                ])
            return LLMResponse(text="Found 3 videos.", tool_calls=[])

        async def mock_dispatch(name, args, user):
            return {"found": True, "results": []}

        with patch("assistant.router.call_llm_with_tools", mock_llm):
            with patch("assistant.router._dispatch_tool", mock_dispatch):
                chunks = _collect(_generate([], {}, {}))

        events = [_parse(c) for c in chunks]
        types = [e["type"] for e in events]
        assert "tool_start" in types
        assert types.index("tool_start") < types.index("token")
        assert events[-1]["type"] == "done"
        tool_ev = next(e for e in events if e["type"] == "tool_start")
        assert tool_ev["name"] == "search_videos"

    def test_no_tools_streams_text_directly(self):
        from assistant.router import _generate
        from assistant.llm import LLMResponse

        async def mock_llm(*args, **kwargs):
            return LLMResponse(text="Hello world.", tool_calls=[])

        with patch("assistant.router.call_llm_with_tools", mock_llm):
            chunks = _collect(_generate([], {}, {}))

        events = [_parse(c) for c in chunks]
        tokens = [e for e in events if e["type"] == "token"]
        assert len(tokens) > 0
        full = "".join(t["content"] for t in tokens)
        assert "Hello" in full
        assert events[-1]["type"] == "done"

    def test_llm_exception_emits_error(self):
        from assistant.router import _generate

        async def mock_llm(*args, **kwargs):
            raise RuntimeError("LLM unavailable")

        with patch("assistant.router.call_llm_with_tools", mock_llm):
            chunks = _collect(_generate([], {}, {}))

        events = [_parse(c) for c in chunks]
        assert events[0]["type"] == "error"
        assert "LLM unavailable" in events[0]["message"]
