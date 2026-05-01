import json
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from typing import Any

from database import get_db
from auth.dependencies import require_admin

router = APIRouter()

class UpdateSettingRequest(BaseModel):
    value: Any

_MASKED_KEYS = {
    "smtp_config": "smtp_password",
    "transcript_config": "api_key",
}

@router.get("/{key}")
async def get_setting(key: str):
    db = await get_db()
    row = await db.fetchrow("SELECT value FROM app_settings WHERE key = $1", key)
    if not row:
        return None
    data = json.loads(row["value"])
    if key in _MASKED_KEYS and isinstance(data, dict):
        field = _MASKED_KEYS[key]
        if data.get(field):
            data[field] = "••••••••"
    return data

@router.put("/admin/{key}")
async def put_setting(key: str, req: UpdateSettingRequest, admin: dict = Depends(require_admin)):
    db = await get_db()
    value = req.value

    # Preserve secret fields when caller omits them
    if key in _MASKED_KEYS and isinstance(value, dict):
        field = _MASKED_KEYS[key]
        if not value.get(field):
            existing = await db.fetchrow("SELECT value FROM app_settings WHERE key = $1", key)
            if existing:
                try:
                    existing_cfg = json.loads(existing["value"])
                    if existing_cfg.get(field):
                        value = {**value, field: existing_cfg[field]}
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
