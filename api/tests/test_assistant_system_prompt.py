"""Tests for admin-configurable assistant system prompt (issue #113)."""
import asyncio
from unittest.mock import patch, AsyncMock, MagicMock


def _run(coro):
    return asyncio.run(coro)


# ── _build_system_prompt uses configured prompt ───────────────────────────────

class TestBuildSystemPrompt:
    def test_falls_back_to_default_when_no_config(self):
        from assistant.llm import _build_system_prompt
        result = _build_system_prompt({}, {})
        assert "MST AI Portal" in result
        assert len(result) > 20

    def test_includes_page_title_when_present(self):
        from assistant.llm import _build_system_prompt
        result = _build_system_prompt({"path": "/ignite/python", "title": "Python Basics"}, {})
        assert "Python Basics" in result

    def test_uses_custom_system_prompt_when_configured(self):
        from assistant.llm import _build_system_prompt
        custom = "You are a specialist in Python programming."
        result = _build_system_prompt({}, {}, custom_system_prompt=custom)
        assert "Python programming" in result

    def test_custom_prompt_still_appends_page_context(self):
        from assistant.llm import _build_system_prompt
        custom = "Custom base prompt."
        result = _build_system_prompt({"title": "LLM Basics"}, {}, custom_system_prompt=custom)
        assert "Custom base prompt" in result
        assert "LLM Basics" in result


# ── GET /admin/assistant-config ───────────────────────────────────────────────

class TestAssistantConfigRoute:
    def test_get_config_route_exists(self):
        from assistant.admin_router import router
        paths = [r.path for r in router.routes]
        assert "/assistant-config" in paths

    def test_returns_current_system_prompt(self):
        from assistant.admin_router import get_assistant_config
        row = MagicMock()
        row.__getitem__ = lambda s, k: {
            "assistant_system_prompt": "Custom prompt here",
        }[k]
        db = MagicMock()
        db.fetchrow = AsyncMock(return_value=row)
        with patch("assistant.admin_router.get_db", AsyncMock(return_value=db)):
            result = _run(get_assistant_config(user={"id": "a1", "role": "admin"}))
        assert result["system_prompt"] == "Custom prompt here"

    def test_returns_empty_string_when_not_configured(self):
        from assistant.admin_router import get_assistant_config
        db = MagicMock()
        db.fetchrow = AsyncMock(return_value=None)
        with patch("assistant.admin_router.get_db", AsyncMock(return_value=db)):
            result = _run(get_assistant_config(user={"id": "a1", "role": "admin"}))
        assert result["system_prompt"] == ""


# ── PUT /admin/assistant-config ───────────────────────────────────────────────

class TestUpdateAssistantConfig:
    def test_update_config_route_exists(self):
        from assistant.admin_router import router
        methods_map = {r.path: r.methods for r in router.routes}
        assert "PUT" in methods_map.get("/assistant-config", set())

    def test_saves_system_prompt(self):
        from assistant.admin_router import update_assistant_config, AssistantConfigUpdate
        db = MagicMock()
        db.execute = AsyncMock()
        with patch("assistant.admin_router.get_db", AsyncMock(return_value=db)):
            result = _run(update_assistant_config(
                body=AssistantConfigUpdate(system_prompt="New custom prompt"),
                user={"id": "a1", "role": "admin"},
            ))
        assert result["ok"] is True
        db.execute.assert_called_once()


# ── call_llm_with_tools reads configured prompt ───────────────────────────────

class TestCallLlmUsesConfiguredPrompt:
    def test_generate_passes_configured_prompt_to_llm(self):
        """_generate reads assistant config and passes it to call_llm_with_tools."""
        import json
        from assistant.router import _generate

        captured_system = []

        async def mock_llm(messages, tools, system_prompt):
            captured_system.append(system_prompt)
            from assistant.llm import LLMResponse
            return LLMResponse(text="Hello", tool_calls=[])

        async def mock_get_config():
            return "Custom: You are a portal expert."

        async def collect():
            chunks = []
            async for chunk in _generate([], {}, {}):
                chunks.append(chunk)
            return chunks

        with patch("assistant.router.call_llm_with_tools", mock_llm):
            with patch("assistant.router._get_assistant_system_prompt", mock_get_config):
                asyncio.run(collect())

        assert len(captured_system) == 1
        assert "Custom: You are a portal expert." in captured_system[0]
