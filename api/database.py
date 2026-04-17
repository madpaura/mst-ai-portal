import asyncpg
from config import settings

_write_pool: asyncpg.Pool | None = None
_read_pool: asyncpg.Pool | None = None

# asyncpg prepared-statement cache must be disabled when connecting through
# PgBouncer in transaction mode — otherwise queries fail with
# "prepared statement does not exist".
_PGBOUNCER_CONNECT_ARGS = {"statement_cache_size": 0}


def _write_url() -> str:
    return settings.DATABASE_WRITE_URL or settings.DATABASE_URL


def _read_url() -> str:
    return settings.DATABASE_READ_URL or _write_url()


async def init_db():
    global _write_pool, _read_pool

    _write_pool = await asyncpg.create_pool(
        _write_url(),
        min_size=2,
        max_size=20,
        server_settings={},
        **(_PGBOUNCER_CONNECT_ARGS if settings.DATABASE_WRITE_URL else {}),
    )

    # Reuse the write pool when no separate read URL is configured
    if settings.DATABASE_READ_URL and settings.DATABASE_READ_URL != _write_url():
        _read_pool = await asyncpg.create_pool(
            _read_url(),
            min_size=2,
            max_size=30,
            server_settings={},
            **_PGBOUNCER_CONNECT_ARGS,
        )
    else:
        _read_pool = _write_pool


async def close_db():
    global _write_pool, _read_pool
    if _write_pool:
        await _write_pool.close()
    if _read_pool and _read_pool is not _write_pool:
        await _read_pool.close()
    _write_pool = None
    _read_pool = None


async def get_db() -> asyncpg.Pool:
    """Write pool — use for INSERT / UPDATE / DELETE."""
    if _write_pool is None:
        raise RuntimeError("Database pool not initialized")
    return _write_pool


async def get_write_db() -> asyncpg.Pool:
    """Write pool — alias for get_db()."""
    return await get_db()


async def get_read_db() -> asyncpg.Pool:
    """Read pool — use for SELECT-only queries.

    Points to the replica via PgBouncer read pool when DATABASE_READ_URL is
    configured; falls back to the write pool in single-server mode.
    """
    if _read_pool is None:
        raise RuntimeError("Database pool not initialized")
    return _read_pool
