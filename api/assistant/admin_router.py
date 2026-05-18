"""Admin endpoints for assistant configuration."""
from fastapi import APIRouter, Depends
from pydantic import BaseModel

from auth.dependencies import require_admin
from database import get_db

router = APIRouter()


class AssistantConfigUpdate(BaseModel):
    system_prompt: str


@router.get("/assistant-config")
async def get_assistant_config(user: dict = Depends(require_admin)):
    db = await get_db()
    row = await db.fetchrow(
        "SELECT assistant_system_prompt FROM app_settings LIMIT 1"
    )
    prompt = ""
    if row:
        prompt = row["assistant_system_prompt"] or ""
    return {"system_prompt": prompt}


@router.put("/assistant-config")
async def update_assistant_config(
    body: AssistantConfigUpdate,
    user: dict = Depends(require_admin),
):
    db = await get_db()
    await db.execute(
        "UPDATE app_settings SET assistant_system_prompt=$1",
        body.system_prompt,
    )
    return {"ok": True}
