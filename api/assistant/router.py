"""Assistant chat endpoint — SSE streaming, text-only (no tool calling in this slice)."""
import json
from typing import Optional, AsyncIterator

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from auth.dependencies import get_current_user
from assistant.llm import stream_llm_response

router = APIRouter()


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


def _sse(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"


async def _generate(
    messages: list,
    page_context,
    user: dict,
) -> AsyncIterator[str]:
    """Async generator that yields SSE-formatted event strings."""
    try:
        page_ctx_dict = (
            page_context.model_dump()
            if hasattr(page_context, "model_dump")
            else (page_context if isinstance(page_context, dict) else {})
        )
        async for token in stream_llm_response(messages, page_ctx_dict, user):
            yield _sse({"type": "token", "content": token})
        yield _sse({"type": "done"})
    except Exception as exc:
        yield _sse({"type": "error", "message": str(exc)})


@router.post("/chat")
async def chat(
    req: ChatRequest,
    user: dict = Depends(get_current_user),
):
    messages = [m.model_dump() for m in req.messages]
    return StreamingResponse(
        _generate(messages, req.page_context, user),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )
