"""LLM streaming for the assistant — text-only (no tool calling in this slice)."""
import json
import httpx
from typing import AsyncIterator

from articles.llm import get_llm_settings
from config import settings


async def stream_llm_response(
    messages: list[dict],
    page_context: dict,
    user: dict,
) -> AsyncIterator[str]:
    """Yield response tokens from the configured LLM provider."""
    llm = await get_llm_settings()
    provider = llm["provider"]
    model = llm["model"]
    api_key = llm.get("api_key")
    ollama_url = llm.get("ollama_url")

    system_prompt = _build_system_prompt(page_context, user)

    if provider == "ollama":
        async for token in _stream_ollama(messages, model, ollama_url, system_prompt):
            yield token
    elif provider == "openai":
        if not api_key:
            raise RuntimeError("OpenAI API key not configured in Settings > Marketplace")
        async for token in _stream_openai(messages, model, api_key, system_prompt):
            yield token
    elif provider == "anthropic":
        if not api_key:
            raise RuntimeError("Anthropic API key not configured in Settings > Marketplace")
        async for token in _stream_anthropic(messages, model, api_key, system_prompt):
            yield token
    else:
        raise RuntimeError(f"Unknown LLM provider: {provider}")


def _build_system_prompt(page_context: dict, user: dict) -> str:
    base = (
        "You are a helpful AI assistant for the MST AI Portal. "
        "You help users find content, check statuses, and learn. "
        "Be concise and direct. "
        "If asked how to install something, give the install command and a link."
    )
    path = page_context.get("path", "") if isinstance(page_context, dict) else ""
    title = page_context.get("title", "") if isinstance(page_context, dict) else ""
    if title:
        base += f"\n\nThe user is currently viewing: {title} ({path})"
    return base


async def _call_ollama_text(messages: list[dict], model: str, ollama_url: str | None, system: str) -> str:
    """Non-streaming Ollama call — returns full text (used when streaming unavailable)."""
    url = (ollama_url or settings.OLLAMA_BASE_URL).rstrip("/")
    chat_messages = [{"role": "system", "content": system}] + messages
    async with httpx.AsyncClient(timeout=120.0) as client:
        if not model:
            tags = await client.get(f"{url}/api/tags")
            tags.raise_for_status()
            models = [m["name"] for m in tags.json().get("models", [])]
            if not models:
                raise RuntimeError("No Ollama models available. Run: ollama pull llama3")
            model = models[0]
        resp = await client.post(
            f"{url}/api/chat",
            json={"model": model, "messages": chat_messages, "stream": False},
        )
        if resp.status_code == 404:
            raise RuntimeError(f"Ollama model '{model}' not found. Pull it with: ollama pull {model}")
        resp.raise_for_status()
        return resp.json()["message"]["content"]


async def _stream_ollama(
    messages: list[dict], model: str, ollama_url: str | None, system: str
) -> AsyncIterator[str]:
    """Stream tokens from Ollama /api/chat."""
    url = (ollama_url or settings.OLLAMA_BASE_URL).rstrip("/")
    chat_messages = [{"role": "system", "content": system}] + messages

    async with httpx.AsyncClient(timeout=120.0) as client:
        if not model:
            tags = await client.get(f"{url}/api/tags")
            tags.raise_for_status()
            models = [m["name"] for m in tags.json().get("models", [])]
            if not models:
                raise RuntimeError("No Ollama models available. Run: ollama pull llama3")
            model = models[0]

        async with client.stream(
            "POST",
            f"{url}/api/chat",
            json={"model": model, "messages": chat_messages, "stream": True},
        ) as resp:
            if resp.status_code == 404:
                raise RuntimeError(f"Ollama model '{model}' not found.")
            resp.raise_for_status()
            async for line in resp.aiter_lines():
                if not line:
                    continue
                try:
                    data = json.loads(line)
                except json.JSONDecodeError:
                    continue
                content = data.get("message", {}).get("content", "")
                if content:
                    yield content
                if data.get("done"):
                    break


async def _stream_openai(
    messages: list[dict], model: str, api_key: str, system: str
) -> AsyncIterator[str]:
    """Stream tokens from OpenAI /v1/chat/completions."""
    chat_messages = [{"role": "system", "content": system}] + messages
    async with httpx.AsyncClient(timeout=120.0) as client:
        async with client.stream(
            "POST",
            "https://api.openai.com/v1/chat/completions",
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={
                "model": model or "gpt-4o-mini",
                "messages": chat_messages,
                "stream": True,
                "temperature": 0.7,
            },
        ) as resp:
            if resp.status_code == 401:
                raise RuntimeError("OpenAI API key is invalid or expired.")
            resp.raise_for_status()
            async for line in resp.aiter_lines():
                if not line.startswith("data: "):
                    continue
                payload = line[len("data: "):]
                if payload == "[DONE]":
                    break
                try:
                    data = json.loads(payload)
                except json.JSONDecodeError:
                    continue
                delta = data["choices"][0]["delta"]
                content = delta.get("content", "")
                if content:
                    yield content


async def _stream_anthropic(
    messages: list[dict], model: str, api_key: str, system: str
) -> AsyncIterator[str]:
    """Stream tokens from Anthropic /v1/messages."""
    async with httpx.AsyncClient(timeout=120.0) as client:
        async with client.stream(
            "POST",
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json={
                "model": model or "claude-sonnet-4-6",
                "max_tokens": 4096,
                "system": system,
                "messages": messages,
                "stream": True,
            },
        ) as resp:
            if resp.status_code == 401:
                raise RuntimeError("Anthropic API key is invalid.")
            resp.raise_for_status()
            async for line in resp.aiter_lines():
                if not line.startswith("data: "):
                    continue
                try:
                    data = json.loads(line[len("data: "):])
                except json.JSONDecodeError:
                    continue
                if data.get("type") == "content_block_delta":
                    text = data.get("delta", {}).get("text", "")
                    if text:
                        yield text
