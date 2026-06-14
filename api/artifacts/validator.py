"""Artifact security validation, backed by the SkillSpector sidecar service.

Replaces the previous regex-only secret/risky-pattern scanner. Skill and MCP
submissions are sent to the SkillSpector container (NVIDIA SkillSpector) which
returns a 0-100 risk report. We block submission only on CRITICAL findings;
everything else surfaces as a non-blocking warning so contributors can see and
act on the full report. Agent artifacts are out of scope and pass through.
"""
from __future__ import annotations

import logging

import httpx

from config import settings

logger = logging.getLogger(__name__)

# SkillSpector targets agent skills and MCP servers. Plain "agent" artifacts are
# not scanned (see scan-scope decision in the Artifact Hub).
SCANNED_TYPES = {"skill", "mcp"}


def _map_llm(llm: dict) -> dict | None:
    """Map the portal's resolved LLM settings to a SkillSpector LLM config.

    SkillSpector speaks the OpenAI provider protocol (plus native Anthropic). The
    portal's in-house provider is OpenAI-compatible; Ollama exposes an OpenAI
    surface under /v1. Returns None when there is no usable endpoint (caller then
    falls back to static-only analysis).
    """
    provider = llm.get("provider")
    model = llm.get("model") or None

    if provider == "openai_compatible":
        base_url = llm.get("base_url")
        if not base_url:
            return None
        return {"provider": "openai", "base_url": base_url.rstrip("/"),
                "api_key": llm.get("api_key"), "model": model}

    if provider == "ollama":
        ollama_url = (llm.get("ollama_url") or settings.OLLAMA_BASE_URL or "").rstrip("/")
        if not ollama_url:
            return None
        return {"provider": "openai", "base_url": f"{ollama_url}/v1",
                "api_key": "ollama", "model": model}

    if provider == "openai":
        return {"provider": "openai", "base_url": llm.get("base_url"),
                "api_key": llm.get("api_key"), "model": model}

    if provider == "anthropic":
        return {"provider": "anthropic", "base_url": None,
                "api_key": llm.get("api_key"), "model": model}

    return None


def _skip_result(note: str) -> dict:
    return {"passed": True, "errors": [], "warnings": [], "scanner": "skillspector",
            "score": None, "risk_severity": None, "recommendation": None,
            "scanned": False, "note": note}


def _map_report(report: dict) -> dict:
    """Convert a SkillSpector JSON report into the portal's validation result.

    Block threshold: the *overall* risk severity is CRITICAL (score 81-100,
    SkillSpector's "DO NOT INSTALL" verdict). Per-finding CRITICAL is rare —
    SkillSpector drives a malicious skill's verdict mainly through HIGH findings
    and the score — so gating on overall severity is what "block on CRITICAL
    only" means in practice. HIGH/CRITICAL findings are surfaced as prominent
    (red) errors; MEDIUM/LOW as advisory warnings. Everything is always shown.
    """
    ra = report.get("risk_assessment") or {}
    overall = (ra.get("severity") or "").upper()
    passed = overall != "CRITICAL"
    errors: list[dict] = []
    warnings: list[dict] = []

    for it in report.get("issues") or []:
        loc = it.get("location") or {}
        sev = (it.get("severity") or "").upper()
        is_serious = sev in ("CRITICAL", "HIGH")
        issue = {
            "severity": "error" if is_serious else "warning",
            "file": loc.get("file") or "-",
            "line": loc.get("start_line") or 0,
            "end_line": loc.get("end_line"),
            "message": (it.get("explanation") or it.get("finding")
                        or it.get("pattern") or it.get("id") or "Security finding"),
            "pattern": it.get("pattern") or it.get("category"),
            "rule_id": it.get("id"),
            "category": it.get("category"),
            "risk_level": sev or None,
            "confidence": it.get("confidence"),
            "explanation": it.get("explanation"),
            "remediation": it.get("remediation"),
            "code_snippet": it.get("code_snippet") or it.get("finding"),
        }
        (errors if is_serious else warnings).append(issue)

    return {
        "passed": passed,
        "errors": errors,
        "warnings": warnings,
        "scanner": "skillspector",
        "score": ra.get("score"),
        "risk_severity": ra.get("severity"),
        "recommendation": ra.get("recommendation"),
        "scanned": True,
        "used_llm": report.get("used_llm"),
        "note": None,
    }


async def validate_files(files: list[dict], artifact_type: str | None = None) -> dict:
    """Run security validation on submitted artifact files.

    Returns a dict with keys: passed (bool), errors (list), warnings (list), plus
    SkillSpector summary fields (score, risk_severity, recommendation, scanned).
    """
    # Scope: only skills and MCPs are scanned by SkillSpector.
    if artifact_type and artifact_type not in SCANNED_TYPES:
        return _skip_result(f"SkillSpector scan does not apply to '{artifact_type}' artifacts.")

    # Resolve the active LLM for SkillSpector's semantic stage (best precision).
    use_llm = bool(settings.SKILLSPECTOR_USE_LLM)
    llm_payload = None
    if use_llm:
        try:
            from articles.llm import get_llm_settings
            llm_payload = _map_llm(await get_llm_settings())
        except Exception as exc:  # noqa: BLE001 — LLM is optional, degrade to static
            logger.warning("Could not resolve LLM for SkillSpector; using static-only: %s", exc)
            llm_payload = None
        if llm_payload is None:
            use_llm = False

    payload = {
        "files": [{"name": f.get("name", "file"), "content": f.get("content", "")} for f in files],
        "use_llm": use_llm,
        "llm": llm_payload,
    }
    url = settings.SKILLSPECTOR_SERVICE_URL.rstrip("/") + "/scan"

    try:
        async with httpx.AsyncClient(timeout=settings.SKILLSPECTOR_TIMEOUT) as client:
            resp = await client.post(url, json=payload)
            resp.raise_for_status()
            report = resp.json()
    except Exception as exc:  # noqa: BLE001 — scanner availability shouldn't 500 the API
        logger.warning("SkillSpector scan failed (%s): %s", url, exc)
        if settings.SKILLSPECTOR_FAIL_CLOSED:
            return {
                "passed": False, "scanner": "skillspector", "scanned": False,
                "score": None, "risk_severity": None, "recommendation": None,
                "errors": [{
                    "severity": "error", "file": "-", "line": 0,
                    "message": "Security scanner is unavailable; submission blocked (fail-closed).",
                    "pattern": "scanner-unavailable",
                }],
                "warnings": [],
                "note": "SkillSpector service unreachable.",
            }
        return {
            "passed": True, "scanner": "skillspector", "scanned": False,
            "score": None, "risk_severity": None, "recommendation": None,
            "errors": [],
            "warnings": [{
                "severity": "warning", "file": "-", "line": 0,
                "message": "Security scanner is unavailable — submission allowed without a scan.",
                "pattern": "scanner-unavailable",
            }],
            "note": "SkillSpector service unreachable.",
        }

    return _map_report(report)
