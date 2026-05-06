"""
Async Redis client — graceful degradation when Redis is unavailable.
"""
import redis.asyncio as aioredis
from loguru import logger as log

_client: aioredis.Redis | None = None


async def init_redis(url: str) -> None:
    global _client
    try:
        r = aioredis.from_url(
            url,
            encoding="utf-8",
            decode_responses=True,
            socket_connect_timeout=2,
            socket_timeout=2,
        )
        await r.ping()
        _client = r
        log.info("Redis connected: {}", url)
    except Exception as exc:
        log.warning("Redis unavailable — caching disabled: {}", exc)
        _client = None


async def close_redis() -> None:
    global _client
    if _client:
        await _client.aclose()
        _client = None


def get_client() -> aioredis.Redis | None:
    return _client
