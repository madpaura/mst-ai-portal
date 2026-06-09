import json
import httpx
from fastapi import HTTPException
from database import get_db
from config import settings


# Identifying headers the in-house OpenAI-compatible gateway strictly requires on
# every request. Mirror the values the gateway was provisioned against (RooCode).
INHOUSE_LLM_HEADERS = {
    "User-Agent": "RooCode/3.52.3",
    "X-Title": "Roo Code",
    "HTTP-Referer": "https://github.com/RooVetGit/Roo-Cline",
}


def parse_inhouse_llm_config(raw: str | None) -> dict | None:
    """Parse the app_settings 'inhouse_llm_config' JSON. Returns the config dict only
    when it is enabled and has a base URL — otherwise None (so callers fall back to
    the normal forge/ollama resolution)."""
    if not raw:
        return None
    try:
        cfg = json.loads(raw)
    except Exception:
        return None
    if not isinstance(cfg, dict):
        return None
    if not cfg.get("enabled"):
        return None
    base_url = (cfg.get("base_url") or "").strip()
    if not base_url:
        return None
    return {
        "provider": "openai_compatible",
        "model": cfg.get("model") or "",
        "api_key": cfg.get("api_key") or None,
        "base_url": base_url.rstrip("/"),
        "context_size": cfg.get("context_size") or None,
        "max_output_tokens": cfg.get("max_output_tokens") or None,
        "temperature": cfg.get("temperature", 0.3),
        "ollama_url": None,
    }


async def get_llm_settings() -> dict:
    """Resolve the active LLM provider.

    Order of precedence:
      1. In-house OpenAI-compatible provider (app_settings 'inhouse_llm_config') when enabled.
      2. The active forge_settings row.
      3. Portal-wide Ollama config (app_settings 'ollama_config').
    """
    db = await get_db()

    # 1. In-house OpenAI-compatible provider takes precedence when enabled.
    inhouse_row = await db.fetchrow("SELECT value FROM app_settings WHERE key = 'inhouse_llm_config'")
    inhouse = parse_inhouse_llm_config(inhouse_row["value"] if inhouse_row else None)
    if inhouse:
        return inhouse

    row = await db.fetchrow(
        "SELECT llm_provider, llm_model, llm_api_key, ollama_url FROM forge_settings WHERE is_active = true LIMIT 1"
    )

    # Portal-wide Ollama URL/model saved by the Settings admin page
    app_ollama_url = None
    app_ollama_model = None
    cfg_row = await db.fetchrow("SELECT value FROM app_settings WHERE key = 'ollama_config'")
    if cfg_row:
        try:
            cfg = json.loads(cfg_row["value"])
            app_ollama_url = cfg.get("base_url") or None
            app_ollama_model = cfg.get("model") or None
        except Exception:
            pass

    if not row:
        return {
            "provider": "ollama",
            "model": app_ollama_model or "",
            "api_key": None,
            "ollama_url": app_ollama_url,
            "base_url": None,
            "max_output_tokens": None,
            "temperature": 0.3,
        }
    return {
        "provider": row["llm_provider"],
        "model": row["llm_model"] or app_ollama_model or "",
        "api_key": row.get("llm_api_key"),
        # forge_settings URL takes precedence; fall back to portal-wide setting
        "ollama_url": row.get("ollama_url") or app_ollama_url,
        "base_url": None,
        "max_output_tokens": None,
        "temperature": 0.3,
    }


async def call_llm(prompt: str) -> str:
    """Call configured LLM provider and return the response text."""
    llm = await get_llm_settings()
    provider = llm["provider"]
    model = llm["model"]
    api_key = llm["api_key"]

    try:
        if provider == "ollama":
            return await _call_ollama(prompt, model, llm.get("ollama_url"))
        elif provider == "openai_compatible":
            base_url = llm.get("base_url")
            if not base_url:
                raise HTTPException(status_code=502, detail="In-house LLM base URL not configured in Settings.")
            return await _call_openai_compatible(
                prompt, model, api_key, base_url,
                max_tokens=llm.get("max_output_tokens"),
                temperature=llm.get("temperature", 0.3),
            )
        elif provider == "openai":
            if not api_key:
                raise HTTPException(status_code=502, detail="OpenAI API key not configured in Settings > Marketplace")
            return await _call_openai(prompt, model, api_key)
        elif provider == "anthropic":
            if not api_key:
                raise HTTPException(status_code=502, detail="Anthropic API key not configured in Settings > Marketplace")
            return await _call_anthropic(prompt, model, api_key)
        else:
            raise HTTPException(status_code=502, detail=f"Unknown LLM provider: {provider}")
    except HTTPException:
        raise
    except httpx.ConnectError:
        raise HTTPException(status_code=502, detail=f"Cannot connect to {provider}. Check your LLM settings.")
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"LLM error ({provider}): {str(e)}")


async def _call_ollama(prompt: str, model: str, ollama_url_override: str | None = None) -> str:
    ollama_url = (ollama_url_override or settings.OLLAMA_BASE_URL).rstrip("/")
    async with httpx.AsyncClient(timeout=120.0) as client:
        # Auto-detect model if not configured
        if not model:
            tags_resp = await client.get(f"{ollama_url}/api/tags")
            tags_resp.raise_for_status()
            models = [m["name"] for m in tags_resp.json().get("models", [])]
            if not models:
                raise HTTPException(status_code=502, detail="No Ollama models available. Run: ollama pull llama3")
            model = models[0]

        resp = await client.post(
            f"{ollama_url}/api/generate",
            json={"model": model, "prompt": prompt, "stream": False},
        )
        if resp.status_code == 404:
            raise HTTPException(
                status_code=502,
                detail=f"Ollama model '{model}' not found. Pull it with: ollama pull {model}",
            )
        resp.raise_for_status()
        return resp.json()["response"]


async def _call_openai_compatible(
    prompt: str,
    model: str,
    api_key: str | None,
    base_url: str,
    max_tokens: int | None = None,
    temperature: float = 0.3,
) -> str:
    """Call an in-house OpenAI-compatible chat endpoint at {base_url}/chat/completions."""
    url = base_url.rstrip("/")
    headers = {"Content-Type": "application/json", **INHOUSE_LLM_HEADERS}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    body: dict = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": temperature,
        "stream": False,
    }
    if max_tokens:
        body["max_tokens"] = max_tokens
    async with httpx.AsyncClient(timeout=180.0) as client:
        resp = await client.post(f"{url}/chat/completions", headers=headers, json=body)
        if resp.status_code == 401:
            raise HTTPException(status_code=502, detail="In-house LLM token is invalid or expired.")
        resp.raise_for_status()
        return resp.json()["choices"][0]["message"]["content"]


async def _call_openai(prompt: str, model: str, api_key: str) -> str:
    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.post(
            "https://api.openai.com/v1/chat/completions",
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={
                "model": model or "gpt-4o-mini",
                "messages": [{"role": "user", "content": prompt}],
                "temperature": 0.3,
            },
        )
        if resp.status_code == 401:
            raise HTTPException(status_code=502, detail="OpenAI API key is invalid or expired.")
        resp.raise_for_status()
        return resp.json()["choices"][0]["message"]["content"]


async def _call_anthropic(prompt: str, model: str, api_key: str) -> str:
    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json={
                "model": model or "claude-sonnet-4-20250514",
                "max_tokens": 4096,
                "messages": [{"role": "user", "content": prompt}],
            },
        )
        if resp.status_code == 401:
            raise HTTPException(status_code=502, detail="Anthropic API key is invalid.")
        resp.raise_for_status()
        return resp.json()["content"][0]["text"]
