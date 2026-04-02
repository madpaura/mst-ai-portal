import json
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from typing import Any

from database import get_db
from auth.dependencies import require_admin

router = APIRouter()

class UpdateSettingRequest(BaseModel):
    value: Any

@router.get("/{key}")
async def get_setting(key: str):
    db = await get_db()
    row = await db.fetchrow("SELECT value FROM app_settings WHERE key = $1", key)
    if row:
        return json.loads(row["value"])
    return None

@router.put("/admin/{key}")
async def put_setting(key: str, req: UpdateSettingRequest, admin: dict = Depends(require_admin)):
    db = await get_db()
    value = req.value

    # For smtp_config, preserve existing password if not provided in payload
    if key == "smtp_config" and isinstance(value, dict) and not value.get("smtp_password"):
        existing = await db.fetchrow("SELECT value FROM app_settings WHERE key = $1", key)
        if existing:
            try:
                existing_cfg = json.loads(existing["value"])
                if existing_cfg.get("smtp_password"):
                    value = {**value, "smtp_password": existing_cfg["smtp_password"]}
            except Exception:
                pass

    value_json = json.dumps(value)
    await db.execute(
        """
        INSERT INTO app_settings (key, value)
        VALUES ($1, $2)
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
        """,
        key, value_json
    )
    return {"status": "ok"}
