"""SkillSpector sidecar service.

Wraps NVIDIA SkillSpector's LangGraph workflow behind a small HTTP API so the
portal backend can scan submitted artifact files without pulling SkillSpector's
heavy dependency tree (langgraph, yara-python, openai, ...) into the main API
image.

The portal resolves its active LLM (in-house OpenAI-compatible endpoint or
Ollama) per request and passes the connection details in the request body;
SkillSpector itself reads provider/model/credentials from environment variables,
so we apply them around each invocation under a lock (scans are infrequent and
the env is process-global).
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import tempfile
from contextlib import contextmanager
from pathlib import Path, PurePosixPath

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from skillspector import graph

logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"))
logger = logging.getLogger("skillspector-service")

app = FastAPI(title="SkillSpector Service", version="1.0.0")

# SkillSpector selects its provider/model/credentials from process env at
# invocation time. Serialize scans so concurrent requests can't clobber each
# other's env. Scans are manual (validate / on submit), so this is not a
# throughput concern.
_scan_lock = asyncio.Lock()

# Env vars SkillSpector reads for LLM provider selection. We snapshot and
# restore exactly these around each scan.
_LLM_ENV_KEYS = (
    "SKILLSPECTOR_PROVIDER",
    "SKILLSPECTOR_MODEL",
    "OPENAI_API_KEY",
    "OPENAI_BASE_URL",
    "ANTHROPIC_API_KEY",
)


class LlmConfig(BaseModel):
    provider: str = "openai"           # SkillSpector provider name: openai | anthropic | nv_build
    base_url: str | None = None        # OpenAI-compatible base URL (in-house / Ollama /v1 / vLLM)
    api_key: str | None = None
    model: str | None = None


class ScanFile(BaseModel):
    name: str
    content: str = ""


class ScanRequest(BaseModel):
    files: list[ScanFile]
    use_llm: bool = True
    llm: LlmConfig | None = None


@contextmanager
def _llm_env(llm: LlmConfig | None, use_llm: bool):
    """Temporarily apply the caller's LLM config to the environment."""
    saved = {k: os.environ.get(k) for k in _LLM_ENV_KEYS}
    try:
        if use_llm and llm is not None:
            os.environ["SKILLSPECTOR_PROVIDER"] = llm.provider or "openai"
            if llm.model:
                os.environ["SKILLSPECTOR_MODEL"] = llm.model
            else:
                os.environ.pop("SKILLSPECTOR_MODEL", None)
            if (llm.provider or "openai") == "anthropic":
                if llm.api_key:
                    os.environ["ANTHROPIC_API_KEY"] = llm.api_key
            else:
                # openai / openai-compatible path
                # Many self-hosted endpoints (Ollama, vLLM) accept any key; send a
                # placeholder when none is configured so the client initializes.
                os.environ["OPENAI_API_KEY"] = llm.api_key or "sk-noauth"
                if llm.base_url:
                    os.environ["OPENAI_BASE_URL"] = llm.base_url
                else:
                    os.environ.pop("OPENAI_BASE_URL", None)
        yield
    finally:
        for k, v in saved.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v


def _materialize(files: list[ScanFile], root: Path) -> int:
    """Write submitted files into a scratch dir, sanitizing paths to stay inside root."""
    written = 0
    for f in files:
        # Drop absolute markers and parent-dir traversal so a malicious filename
        # can't escape the scratch directory.
        parts = [p for p in PurePosixPath(f.name or "").parts if p not in ("", "/", "..")]
        if not parts:
            continue
        dest = root.joinpath(*parts)
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(f.content or "", encoding="utf-8")
        written += 1
    return written


def _run_graph(input_path: str, use_llm: bool) -> dict:
    """Invoke the SkillSpector graph and parse its JSON report body."""
    result = graph.invoke(
        {
            "input_path": input_path,
            "output_format": "json",
            "use_llm": use_llm,
        }
    )
    body = result.get("report_body")
    if body:
        try:
            return json.loads(body)
        except (TypeError, ValueError):
            pass
    # Fallback: assemble a minimal report from raw state fields.
    return {
        "skill": {"name": "unknown"},
        "risk_assessment": {
            "score": result.get("risk_score"),
            "severity": result.get("risk_severity"),
            "recommendation": result.get("risk_recommendation"),
        },
        "components": [],
        "issues": [],
        "metadata": {},
    }


@app.get("/health")
async def health() -> dict:
    return {"status": "ok", "service": "skillspector"}


@app.post("/scan")
async def scan(req: ScanRequest) -> dict:
    if not req.files:
        raise HTTPException(status_code=400, detail="No files supplied to scan")

    async with _scan_lock:
        with tempfile.TemporaryDirectory(prefix="skillspector-") as tmp:
            root = Path(tmp)
            if _materialize(req.files, root) == 0:
                raise HTTPException(status_code=400, detail="No valid files to scan")
            try:
                with _llm_env(req.llm, req.use_llm):
                    report = await asyncio.to_thread(_run_graph, str(root), req.use_llm)
            except Exception as exc:  # noqa: BLE001 — surface scanner failures to the caller
                logger.exception("SkillSpector scan failed")
                raise HTTPException(status_code=502, detail=f"Scan failed: {exc}") from exc

    report["used_llm"] = req.use_llm
    return report
