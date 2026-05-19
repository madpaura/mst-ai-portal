"""LLM client for the assistant — streaming and tool-calling across providers."""
import json
import uuid
import httpx
from dataclasses import dataclass, field
from typing import AsyncIterator

from articles.llm import get_llm_settings
from config import settings


# ── Data types ────────────────────────────────────────────────────────────────

@dataclass
class ToolCall:
    id: str
    name: str
    arguments: dict


@dataclass
class LLMResponse:
    text: str | None
    tool_calls: list[ToolCall] = field(default_factory=list)


# ── Provider response parsers ─────────────────────────────────────────────────

def parse_ollama_response(response: dict) -> LLMResponse:
    """Normalise an Ollama /api/chat response into LLMResponse."""
    msg = response.get("message", {})
    raw_calls = msg.get("tool_calls") or []
    tool_calls = []
    for tc in raw_calls:
        fn = tc.get("function", {})
        tool_calls.append(ToolCall(
            id=str(uuid.uuid4()),
            name=fn["name"],
            arguments=fn.get("arguments") or {},
        ))
    text = msg.get("content") or None
    if tool_calls:
        text = None
    return LLMResponse(text=text, tool_calls=tool_calls)


def parse_openai_response(response: dict) -> LLMResponse:
    """Normalise an OpenAI /v1/chat/completions response into LLMResponse."""
    choice = response["choices"][0]
    msg = choice["message"]
    raw_calls = msg.get("tool_calls") or []
    tool_calls = []
    for tc in raw_calls:
        args = tc["function"]["arguments"]
        if isinstance(args, str):
            try:
                args = json.loads(args)
            except json.JSONDecodeError:
                args = {}
        tool_calls.append(ToolCall(id=tc["id"], name=tc["function"]["name"], arguments=args))
    text = msg.get("content")
    if tool_calls:
        text = None
    return LLMResponse(text=text, tool_calls=tool_calls)


def parse_anthropic_response(response: dict) -> LLMResponse:
    """Normalise an Anthropic /v1/messages response into LLMResponse."""
    tool_calls = []
    text = None
    for block in response.get("content", []):
        if block["type"] == "tool_use":
            tool_calls.append(ToolCall(
                id=block["id"],
                name=block["name"],
                arguments=block.get("input") or {},
            ))
        elif block["type"] == "text":
            text = block["text"]
    return LLMResponse(text=text, tool_calls=tool_calls)


# ── Schema / message converters ───────────────────────────────────────────────

def to_anthropic_tools(tools: list[dict]) -> list[dict]:
    """Convert OpenAI-format tool schemas to Anthropic format."""
    result = []
    for t in tools:
        fn = t["function"]
        result.append({
            "name": fn["name"],
            "description": fn.get("description", ""),
            "input_schema": fn.get("parameters", {"type": "object", "properties": {}}),
        })
    return result


def to_anthropic_messages(messages: list[dict]) -> list[dict]:
    """Convert internal OpenAI-format messages to Anthropic message format."""
    result = []
    i = 0
    while i < len(messages):
        msg = messages[i]
        role = msg["role"]

        if role == "system":
            i += 1
            continue

        if role == "tool":
            # Batch consecutive tool results into one user message
            blocks = []
            while i < len(messages) and messages[i]["role"] == "tool":
                m = messages[i]
                blocks.append({
                    "type": "tool_result",
                    "tool_use_id": m["tool_call_id"],
                    "content": m["content"],
                })
                i += 1
            result.append({"role": "user", "content": blocks})
            continue

        if role == "assistant" and msg.get("tool_calls"):
            content_blocks = []
            if msg.get("content"):
                content_blocks.append({"type": "text", "text": msg["content"]})
            for tc in msg["tool_calls"]:
                content_blocks.append({
                    "type": "tool_use",
                    "id": tc["id"],
                    "name": tc["function"]["name"],
                    "input": tc["function"]["arguments"],
                })
            result.append({"role": "assistant", "content": content_blocks})
            i += 1
            continue

        result.append({"role": role, "content": msg.get("content") or ""})
        i += 1
    return result


# ── Non-streaming tool call ───────────────────────────────────────────────────

async def call_llm_with_tools(
    messages: list[dict],
    tools: list[dict],
    system_prompt: str,
) -> LLMResponse:
    """Non-streaming LLM call with optional tool schemas. Returns LLMResponse."""
    llm = await get_llm_settings()
    provider = llm["provider"]
    model = llm["model"]
    api_key = llm.get("api_key")
    ollama_url = llm.get("ollama_url")

    if provider == "ollama":
        raw = await _call_ollama_with_tools(messages, tools, model, ollama_url, system_prompt)
        return parse_ollama_response(raw)
    elif provider == "openai":
        if not api_key:
            raise RuntimeError("OpenAI API key not configured in Settings > Marketplace")
        raw = await _call_openai_with_tools(messages, tools, model, api_key, system_prompt)
        return parse_openai_response(raw)
    elif provider == "anthropic":
        if not api_key:
            raise RuntimeError("Anthropic API key not configured in Settings > Marketplace")
        ant_msgs = to_anthropic_messages(messages)
        ant_tools = to_anthropic_tools(tools) if tools else []
        raw = await _call_anthropic_with_tools(ant_msgs, ant_tools, model, api_key, system_prompt)
        return parse_anthropic_response(raw)
    else:
        raise RuntimeError(f"Unknown LLM provider: {provider}")


async def _call_ollama_with_tools(messages, tools, model, ollama_url, system):
    url = (ollama_url or settings.OLLAMA_BASE_URL).rstrip("/")
    chat_messages = [{"role": "system", "content": system}] + messages
    async with httpx.AsyncClient(timeout=120.0) as client:
        if not model:
            tags = await client.get(f"{url}/api/tags")
            tags.raise_for_status()
            models = [m["name"] for m in tags.json().get("models", [])]
            if not models:
                raise RuntimeError("No Ollama models available.")
            model = models[0]
        body: dict = {"model": model, "messages": chat_messages, "stream": False}
        if tools:
            body["tools"] = tools
        resp = await client.post(f"{url}/api/chat", json=body)
        if resp.status_code == 404:
            raise RuntimeError(f"Ollama model '{model}' not found.")
        resp.raise_for_status()
        return resp.json()


async def _call_openai_with_tools(messages, tools, model, api_key, system):
    chat_messages = [{"role": "system", "content": system}] + messages
    body: dict = {"model": model or "gpt-4o-mini", "messages": chat_messages, "temperature": 0.7}
    if tools:
        body["tools"] = tools
    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.post(
            "https://api.openai.com/v1/chat/completions",
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json=body,
        )
        if resp.status_code == 401:
            raise RuntimeError("OpenAI API key is invalid or expired.")
        resp.raise_for_status()
        return resp.json()


async def _call_anthropic_with_tools(messages, tools, model, api_key, system):
    body: dict = {
        "model": model or "claude-sonnet-4-6",
        "max_tokens": 4096,
        "system": system,
        "messages": messages,
    }
    if tools:
        body["tools"] = tools
    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json=body,
        )
        if resp.status_code == 401:
            raise RuntimeError("Anthropic API key is invalid.")
        resp.raise_for_status()
        return resp.json()


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


def _build_system_prompt(page_context: dict, user: dict, custom_system_prompt: str | None = None) -> str:
    base = custom_system_prompt or (
        "You are a portal assistant for the MST AI Portal. "
        "You ONLY answer using data returned by tools. "
        "You have NO general knowledge and must NOT use it.\n\n"
        "## Strict rules\n"
        "1. ALWAYS call a tool first. Never answer without calling a tool.\n"
        "2. Your response MUST be based solely on what the tool returned. "
        "Do not add, infer, or guess anything beyond the tool result.\n"
        "3. If a tool returns `found: false` or empty results, reply only: "
        "\"I couldn't find anything matching that in the portal.\"\n"
        "4. Never explain how tools work. Never show JSON. Just call the tool and present the result.\n"
        "5. If no tool covers the question, reply: "
        "\"I can only answer questions about portal content, videos, articles, solutions, "
        "marketplace components, and your request statuses.\"\n\n"
        "## How to format results\n"
        "For each result item, use this exact structure (fill in real values from the tool data):\n\n"
        "If the result has a thumbnail path, show it first as an image: ![thumbnail](thumbnail_path)\n"
        "Then: ### [actual title from result](actual url from result)\n"
        "Then: **actual type (video/article/skill/agent/mcp)** · actual category value — actual description (keep under 100 chars, no markdown symbols)\n\n"
        "Example for a video result with title='Claude Code Basics', url='/ignite/claude-code', category='ai', description='Learn how to use Claude Code':\n"
        "### [Claude Code Basics](/ignite/claude-code)\n"
        "**video** · ai — Learn how to use Claude Code\n\n"
        "For install commands use a fenced bash block.\n"
        "For status/request lists use: `- **title**: status (date)`"
    )
    path = page_context.get("path", "") if isinstance(page_context, dict) else ""
    title = page_context.get("title", "") if isinstance(page_context, dict) else ""
    if title:
        base += f"\n\nCurrent page: **{title}** (`{path}`)"
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
