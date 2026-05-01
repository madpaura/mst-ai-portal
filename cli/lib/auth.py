"""Token resolution: CLI flag → env var → cached config file → interactive prompt."""
from __future__ import annotations

import json
import os
from pathlib import Path

CONFIG_FILE = Path.home() / ".mst-ingest.json"


def resolve(
    *,
    api_url: str | None = None,
    token: str | None = None,
    username: str | None = None,
    password: str | None = None,
) -> tuple[str, str]:
    """Return (api_url, jwt_token), obtaining credentials as needed."""
    from .api import APIClient, APIError

    cfg = _load_config()

    url = (
        api_url
        or os.environ.get("MST_API_URL")
        or cfg.get("api_url")
        or "http://localhost:8000"
    )

    tok = token or os.environ.get("MST_TOKEN") or cfg.get("token")

    if not tok:
        import click

        usr = username or os.environ.get("MST_USERNAME")
        pwd = password or os.environ.get("MST_PASSWORD")
        if not usr:
            usr = click.prompt("  Username")
        if not pwd:
            pwd = click.prompt("  Password", hide_input=True)

        tok = APIClient.login(url, usr, pwd)
        _save_config({"api_url": url, "token": tok})

    return url, tok


def _load_config() -> dict:
    if CONFIG_FILE.exists():
        try:
            return json.loads(CONFIG_FILE.read_text())
        except Exception:
            pass
    return {}


def _save_config(data: dict) -> None:
    try:
        existing = _load_config()
        existing.update(data)
        CONFIG_FILE.write_text(json.dumps(existing, indent=2))
        CONFIG_FILE.chmod(0o600)
    except Exception:
        pass
