"""Admin endpoints for assistant configuration."""
from typing import Optional
from fastapi import APIRouter, Depends
from pydantic import BaseModel

from auth.dependencies import require_admin
from database import get_db

router = APIRouter()


class AssistantConfigUpdate(BaseModel):
    system_prompt: Optional[str] = None
    enabled: Optional[bool] = None


@router.get("/assistant-config")
async def get_assistant_config(user: dict = Depends(require_admin)):
    db = await get_db()
    row = await db.fetchrow(
        "SELECT assistant_system_prompt, assistant_enabled FROM app_settings LIMIT 1"
    )
    prompt = ""
    enabled = True
    if row:
        prompt = row["assistant_system_prompt"] or ""
        enabled = row["assistant_enabled"] if row["assistant_enabled"] is not None else True
    return {"system_prompt": prompt, "enabled": enabled}


@router.put("/assistant-config")
async def update_assistant_config(
    body: AssistantConfigUpdate,
    user: dict = Depends(require_admin),
):
    db = await get_db()
    if body.system_prompt is not None:
        await db.execute(
            "UPDATE app_settings SET assistant_system_prompt=$1",
            body.system_prompt,
        )
    if body.enabled is not None:
        await db.execute(
            "UPDATE app_settings SET assistant_enabled=$1",
            body.enabled,
        )
    return {"ok": True}
