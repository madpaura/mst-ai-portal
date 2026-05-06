"""
Cache key construction and namespace helpers.
Key format: portal:v1:{namespace}:{op}:{scope}[:{params_hash}]:ver={version}
"""
import hashlib
import json

PREFIX = "portal:v1"

NS_SOLUTIONS = "solutions"
NS_ARTICLES = "articles"
NS_FORGE = "forge"
NS_VIDEO = "video"
NS_MEMES = "memes"

ALL_NAMESPACES = [NS_SOLUTIONS, NS_ARTICLES, NS_FORGE, NS_VIDEO, NS_MEMES]


def ver_key(namespace: str) -> str:
    return f"{PREFIX}:{namespace}:_ver"


def build_key(namespace: str, op: str, scope: str, params: dict | None, version: int) -> str:
    if params:
        h = hashlib.sha256(json.dumps(params, sort_keys=True).encode()).hexdigest()[:8]
        return f"{PREFIX}:{namespace}:{op}:{scope}:{h}:ver={version}"
    return f"{PREFIX}:{namespace}:{op}:{scope}:ver={version}"
