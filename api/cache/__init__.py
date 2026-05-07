from cache.client import init_redis, close_redis, get_client
from cache.service import get_or_set, bump_version, flush_namespace, flush_all, get_stats
from cache.keys import NS_SOLUTIONS, NS_ARTICLES, NS_FORGE, NS_VIDEO, NS_MEMES

__all__ = [
    "init_redis", "close_redis", "get_client",
    "get_or_set", "bump_version", "flush_namespace", "flush_all", "get_stats",
    "NS_SOLUTIONS", "NS_ARTICLES", "NS_FORGE", "NS_VIDEO", "NS_MEMES",
]
