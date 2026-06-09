#!/usr/bin/env python3
"""Standalone connectivity probe for the in-house OpenAI-compatible LLM gateway.

It mirrors exactly what the portal does (same RooCode identifying headers, same
`{base}/models` and `{base}/chat/completions` paths) but tries several base-path
variants so you can see which one the gateway actually serves — handy when the
portal shows "Endpoint returned HTTP 404".

Usage (from a host that can reach the gateway, e.g. prod):

    python3 api/scripts/check_inhouse_llm.py \
        --base-url http://im-light-prd.kspprd.dks.cloud.samsungds.net \
        --token   "$INHOUSE_LLM_TOKEN" \
        --model   admin

Or via environment variables:

    INHOUSE_LLM_BASE_URL=http://host \
    INHOUSE_LLM_TOKEN=xxxx \
    INHOUSE_LLM_MODEL=admin \
        python3 api/scripts/check_inhouse_llm.py

Exit code is 0 if at least one variant returned a usable /models list.
"""
import argparse
import json
import os
import sys

import httpx

# Mirror the headers the portal sends (see api/articles/llm.py INHOUSE_LLM_HEADERS).
INHOUSE_LLM_HEADERS = {
    "User-Agent": "RooCode/3.52.3",
    "X-Title": "Roo Code",
    "HTTP-Referer": "https://github.com/RooVetGit/Roo-Cline",
}


def _candidate_bases(base_url: str) -> list[str]:
    """Return distinct base paths to try, in order of likelihood."""
    base = base_url.strip().rstrip("/")
    candidates = [base]
    # The most common cause of a 404 is a missing version prefix.
    if not base.endswith("/v1"):
        candidates.append(f"{base}/v1")
    if not base.endswith("/api/v1"):
        candidates.append(f"{base}/api/v1")
    # De-dup while preserving order.
    seen, out = set(), []
    for c in candidates:
        if c not in seen:
            seen.add(c)
            out.append(c)
    return out


def _short(text: str, n: int = 600) -> str:
    text = (text or "").strip().replace("\n", " ")
    return text[:n] + ("…" if len(text) > n else "")


def probe_models(client: httpx.Client, base: str, headers: dict) -> tuple[bool, list[str]]:
    url = f"{base}/models"
    print(f"\n→ GET {url}")
    try:
        resp = client.get(url, headers=headers)
    except httpx.ConnectError as e:
        print(f"   ✗ connect error: {e}")
        return False, []
    except httpx.TimeoutException:
        print("   ✗ timed out")
        return False, []
    except Exception as e:  # noqa: BLE001
        print(f"   ✗ error: {e}")
        return False, []

    ct = resp.headers.get("content-type", "")
    print(f"   status={resp.status_code} content-type={ct}")
    print(f"   body={_short(resp.text)}")
    if resp.status_code != 200:
        return False, []
    try:
        data = resp.json()
    except Exception:
        print("   ✗ 200 but body is not JSON")
        return False, []
    items = data.get("data") if isinstance(data, dict) else data
    model_ids = [
        (m.get("id") or m.get("model"))
        for m in (items or [])
        if isinstance(m, dict) and (m.get("id") or m.get("model"))
    ]
    print(f"   ✓ {len(model_ids)} model(s): {model_ids}")
    return True, model_ids


def probe_chat(client: httpx.Client, base: str, headers: dict, model: str) -> bool:
    url = f"{base}/chat/completions"
    body = {
        "model": model,
        "messages": [{"role": "user", "content": "Reply with the single word: ok"}],
        "temperature": 0,
        "max_tokens": 16,
        "stream": False,
    }
    print(f"\n→ POST {url}  (model={model})")
    try:
        resp = client.post(url, headers={**headers, "Content-Type": "application/json"}, json=body)
    except Exception as e:  # noqa: BLE001
        print(f"   ✗ error: {e}")
        return False
    print(f"   status={resp.status_code}")
    print(f"   body={_short(resp.text)}")
    if resp.status_code != 200:
        return False
    try:
        reply = resp.json()["choices"][0]["message"]["content"]
        print(f"   ✓ reply: {reply!r}")
        return True
    except Exception:
        print("   ✗ 200 but unexpected response shape")
        return False


def main() -> int:
    parser = argparse.ArgumentParser(description="Probe the in-house OpenAI-compatible LLM gateway.")
    parser.add_argument("--base-url", default=os.environ.get("INHOUSE_LLM_BASE_URL", ""))
    parser.add_argument("--token", default=os.environ.get("INHOUSE_LLM_TOKEN", ""))
    parser.add_argument("--model", default=os.environ.get("INHOUSE_LLM_MODEL", ""))
    parser.add_argument("--timeout", type=float, default=15.0)
    args = parser.parse_args()

    if not args.base_url:
        parser.error("--base-url (or INHOUSE_LLM_BASE_URL) is required")

    headers = dict(INHOUSE_LLM_HEADERS)
    headers["Accept"] = "application/json"
    if args.token:
        headers["Authorization"] = f"Bearer {args.token}"

    print("=" * 70)
    print("In-house LLM connectivity probe")
    print(f"  base url : {args.base_url}")
    print(f"  token    : {'set (' + str(len(args.token)) + ' chars)' if args.token else 'NOT SET'}")
    print(f"  model    : {args.model or '(none — chat test skipped)'}")
    print("=" * 70)

    working_base = None
    working_models: list[str] = []
    with httpx.Client(timeout=args.timeout, follow_redirects=True) as client:
        for base in _candidate_bases(args.base_url):
            ok, models = probe_models(client, base, headers)
            if ok:
                working_base = base
                working_models = models
                break

    print("\n" + "=" * 70)
    if not working_base:
        print("RESULT: ✗ No working /models endpoint found.")
        print("  • A 404 means the host is reachable but the path is wrong —")
        print("    set the portal Base URL to the variant that works above.")
        print("  • A 401/403 means the path is right but the token is rejected.")
        print("  • A connect error/timeout means a network/DNS/firewall issue.")
        return 1

    print(f"RESULT: ✓ Working base path: {working_base}")
    print(f"  → Set the portal 'Base URL' to: {working_base}")
    if working_models:
        print(f"  → Available models: {working_models}")

    # Optionally verify a chat completion end-to-end.
    if args.model:
        model = args.model
        with httpx.Client(timeout=max(args.timeout, 30.0), follow_redirects=True) as client:
            chat_ok = probe_chat(client, working_base, headers, model)
        print("\n" + "=" * 70)
        print(f"CHAT TEST: {'✓ ok' if chat_ok else '✗ failed (see body above)'}")
        return 0 if chat_ok else 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
