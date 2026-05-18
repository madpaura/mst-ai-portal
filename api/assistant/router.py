"""Assistant chat endpoint — SSE streaming with multi-provider tool-calling loop."""
import json
from typing import Optional, AsyncIterator

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from auth.dependencies import get_current_user
from assistant.llm import call_llm_with_tools, _build_system_prompt
from database import get_db

router = APIRouter()


# ── Request / response schemas ────────────────────────────────────────────────

class Message(BaseModel):
    role: str
    content: str


class PageContext(BaseModel):
    path: str = ""
    title: str = ""
    video_slug: Optional[str] = None


class ChatRequest(BaseModel):
    messages: list[Message]
    page_context: PageContext = PageContext()


# ── Tool dispatch (populated by tools.py in subsequent slices) ────────────────

TOOL_MESSAGES: dict[str, str] = {}


async def _get_assistant_system_prompt() -> str:
    """Read admin-configured system prompt from app_settings, or return empty string."""
    try:
        db = await get_db()
        row = await db.fetchrow("SELECT assistant_system_prompt FROM app_settings LIMIT 1")
        return (row["assistant_system_prompt"] or "") if row else ""
    except Exception:
        return ""


async def _dispatch_tool(name: str, arguments: dict, user: dict) -> dict:
    """Route a tool call to the registered tool function."""
    try:
        from assistant.tools import dispatch_tool
        return await dispatch_tool(name, arguments, user)
    except ImportError:
        return {"error": f"Tool '{name}' not yet available"}
    except Exception as exc:
        return {"error": str(exc)}


# ── SSE helpers ───────────────────────────────────────────────────────────────

def _sse(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"


# ── Core agentic streaming generator ─────────────────────────────────────────

async def _generate(
    messages: list,
    page_context,
    user: dict,
    tools: list | None = None,
) -> AsyncIterator[str]:
    """
    Runs the tool-calling agentic loop, then fake-streams the final
    LLM response word-by-word as SSE token events.
    """
    try:
        page_ctx = (
            page_context.model_dump()
            if hasattr(page_context, "model_dump")
            else (page_context if isinstance(page_context, dict) else {})
        )
        custom_prompt = await _get_assistant_system_prompt()
        system = _build_system_prompt(page_ctx, user, custom_system_prompt=custom_prompt or None)
        history: list[dict] = list(messages) if messages else []
        tool_list = tools or []

        for _ in range(5):
            response = await call_llm_with_tools(history, tool_list, system)

            if response.tool_calls:
                for tc in response.tool_calls:
                    msg = TOOL_MESSAGES.get(tc.name, f"Querying {tc.name}…")
                    yield _sse({"type": "tool_start", "name": tc.name, "message": msg})
                    result = await _dispatch_tool(tc.name, tc.arguments, user)
                    # Append assistant tool-call message + tool result to history
                    history.append({
                        "role": "assistant",
                        "content": None,
                        "tool_calls": [{"id": tc.id, "function": {"name": tc.name, "arguments": tc.arguments}}],
                    })
                    history.append({
                        "role": "tool",
                        "tool_call_id": tc.id,
                        "tool_name": tc.name,
                        "content": json.dumps(result),
                    })
            else:
                # Fake-stream the final text word by word
                text = response.text or ""
                words = text.split(" ")
                for i, word in enumerate(words):
                    token = word + (" " if i < len(words) - 1 else "")
                    if token:
                        yield _sse({"type": "token", "content": token})
                yield _sse({"type": "done"})
                return

        yield _sse({"type": "error", "message": "Could not complete after maximum tool-call rounds."})

    except Exception as exc:
        yield _sse({"type": "error", "message": str(exc)})


# ── Routes ────────────────────────────────────────────────────────────────────

class CompactRequest(BaseModel):
    messages: list[Message]


@router.post("/compact")
async def compact(
    req: CompactRequest | None = None,
    user: dict = Depends(get_current_user),
    messages: list | None = None,
):
    """Summarise a conversation history into a single context string."""
    msgs = messages if messages is not None else (
        [m.model_dump() for m in req.messages] if req else []
    )
    if not msgs:
        return {"summary": ""}
    transcript = "\n".join(
        f"{m['role'].upper()}: {m.get('content') or ''}" for m in msgs
        if m.get("content")
    )
    prompt = (
        "Summarise the following conversation in 2-3 sentences, "
        "capturing the user's intent and any key facts found:\n\n" + transcript
    )
    from assistant.llm import LLMResponse
    response = await call_llm_with_tools(
        [{"role": "user", "content": prompt}], [], ""
    )
    return {"summary": response.text or ""}


@router.post("/chat")
async def chat(
    req: ChatRequest,
    user: dict = Depends(get_current_user),
):
    try:
        from assistant.tools import get_tools_for_role
        tools = get_tools_for_role(user.get("role", "user"))
    except ImportError:
        tools = []

    messages = [m.model_dump() for m in req.messages]
    return StreamingResponse(
        _generate(messages, req.page_context, user, tools),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )
