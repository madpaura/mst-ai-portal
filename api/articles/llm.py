import httpx
from fastapi import HTTPException
from database import get_db
from config import settings


async def get_llm_settings() -> dict:
    """Read LLM settings from forge_settings table."""
    db = await get_db()
    row = await db.fetchrow(
        "SELECT llm_provider, llm_model, llm_api_key, ollama_url FROM forge_settings WHERE is_active = true LIMIT 1"
    )
    if not row:
        return {"provider": "ollama", "model": "", "api_key": None, "ollama_url": None}
    return {
        "provider": row["llm_provider"],
        "model": row["llm_model"],
        "api_key": row.get("llm_api_key"),
        "ollama_url": row.get("ollama_url"),
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
