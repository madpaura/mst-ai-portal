"""
Cache service: get_or_set, bump_version (namespace invalidation), stats.
All Redis failures are logged and bypassed — never raises.
"""
import json
from typing import Any, Callable, Awaitable
from loguru import logger as log

from cache.client import get_client
from cache.keys import ver_key, build_key, ALL_NAMESPACES


async def _get_version(namespace: str) -> int:
    r = get_client()
    if r is None:
        return 0
    try:
        v = await r.get(ver_key(namespace))
        return int(v) if v else 0
    except Exception as exc:
        log.warning("cache: version fetch error ({}): {}", namespace, exc)
        return 0


async def bump_version(namespace: str) -> None:
    """Atomically invalidate all cached data for a namespace."""
    r = get_client()
    if r is None:
        return
    try:
        await r.incr(ver_key(namespace))
    except Exception as exc:
        log.warning("cache: bump_version error ({}): {}", namespace, exc)


async def get_or_set(
    namespace: str,
    op: str,
    scope: str,
    params: dict | None,
    ttl: int,
    fetcher: Callable[[], Awaitable[Any]],
) -> Any:
    """
    Return cached value when present; otherwise call fetcher, store result, return it.
    Falls through to fetcher transparently on any Redis error.
    """
    r = get_client()
    if r is None:
        return await fetcher()

    try:
        version = await _get_version(namespace)
        key = build_key(namespace, op, scope, params, version)
        cached = await r.get(key)
        if cached is not None:
            return json.loads(cached)
    except Exception as exc:
        log.warning("cache: get error: {}", exc)
        return await fetcher()

    result = await fetcher()

    try:
        await r.setex(key, ttl, json.dumps(result, default=str))
    except Exception as exc:
        log.warning("cache: set error: {}", exc)

    return result


async def flush_namespace(namespace: str) -> None:
    await bump_version(namespace)


async def flush_all() -> None:
    for ns in ALL_NAMESPACES:
        await bump_version(ns)


async def get_stats() -> dict:
    r = get_client()
    if r is None:
        return {"enabled": False, "connected": False}
    try:
        mem = await r.info("memory")
        stats = await r.info("stats")
        keyspace = await r.info("keyspace")
        versions = {}
        for ns in ALL_NAMESPACES:
            v = await r.get(ver_key(ns))
            versions[ns] = int(v) if v else 0
        return {
            "enabled": True,
            "connected": True,
            "used_memory_human": mem.get("used_memory_human"),
            "maxmemory_human": mem.get("maxmemory_human"),
            "used_memory_peak_human": mem.get("used_memory_peak_human"),
            "evicted_keys": stats.get("evicted_keys", 0),
            "keyspace_hits": stats.get("keyspace_hits", 0),
            "keyspace_misses": stats.get("keyspace_misses", 0),
            "keyspace": keyspace,
            "namespace_versions": versions,
        }
    except Exception as exc:
        log.warning("cache: stats error: {}", exc)
        return {"enabled": True, "connected": False, "error": str(exc)}
