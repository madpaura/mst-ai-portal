"""Async HTTP request execution with per-request timing → Sample."""
from __future__ import annotations

import time
from typing import Dict, Optional

import httpx

from .metrics import Sample


def make_client(base_url: str, *, verify_tls: bool, http2: bool,
                timeout: float, max_connections: int, transport=None) -> httpx.AsyncClient:
    limits = httpx.Limits(
        max_connections=max_connections,
        max_keepalive_connections=max_connections,
    )
    return httpx.AsyncClient(
        base_url=base_url.rstrip("/"),
        verify=verify_tls,
        http2=http2,
        timeout=httpx.Timeout(timeout, connect=min(timeout, 10.0)),
        limits=limits,
        follow_redirects=False,   # read-only: don't follow into tracked redirects
        headers={"User-Agent": "mst-stress/1.0"},
        transport=transport,      # injectable for self-tests (httpx.MockTransport)
    )


# Status codes we treat as "the server handled it correctly" even though they
# are not 2xx — they are valid read-only outcomes, not server failures.
_OK_NON_2XX = {304, 401, 403, 404}


async def do_request(
    client: httpx.AsyncClient,
    label: str,
    path: str,
    *,
    query: Optional[Dict[str, str]] = None,
    cookie: Optional[str] = None,
    stage: int = 0,
    count_4xx_as_error: bool = False,
) -> Sample:
    headers = {"Cookie": cookie} if cookie else None
    t0 = time.perf_counter()
    ts = time.time()
    status = 0
    nbytes = 0
    err: Optional[str] = None
    try:
        resp = await client.get(path, params=query, headers=headers)
        status = resp.status_code
        nbytes = len(resp.content)
    except httpx.TimeoutException:
        err = "timeout"
    except httpx.ConnectError:
        err = "connect_error"
    except httpx.RemoteProtocolError:
        err = "protocol_error"
    except httpx.HTTPError as e:
        err = f"http_error:{type(e).__name__}"
    except Exception as e:  # pragma: no cover - defensive
        err = f"error:{type(e).__name__}"

    latency_ms = (time.perf_counter() - t0) * 1000.0

    if err is not None:
        ok = False
    elif status >= 500:
        ok = False
        err = f"http_{status}"
    elif status >= 400:
        if count_4xx_as_error and status not in _OK_NON_2XX:
            ok = False
            err = f"http_{status}"
        else:
            ok = status in _OK_NON_2XX or status < 400
            if not ok:
                err = f"http_{status}"
    else:
        ok = True

    return Sample(
        label=label, method="GET", status=status, ok=ok,
        latency_ms=latency_ms, bytes=nbytes, t_start=ts, stage=stage, error=err,
    )
