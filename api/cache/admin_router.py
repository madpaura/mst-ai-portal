from fastapi import APIRouter, Depends
from cache import service as cache_svc
from cache.keys import ALL_NAMESPACES
from auth.dependencies import require_admin

router = APIRouter()


@router.get("/stats")
async def get_cache_stats(admin: dict = Depends(require_admin)):
    return await cache_svc.get_stats()


@router.post("/flush")
async def flush_all_cache(admin: dict = Depends(require_admin)):
    await cache_svc.flush_all()
    return {"flushed": ALL_NAMESPACES}


@router.post("/flush/{namespace}")
async def flush_namespace_cache(namespace: str, admin: dict = Depends(require_admin)):
    if namespace not in ALL_NAMESPACES:
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail=f"Unknown namespace: {namespace}")
    await cache_svc.flush_namespace(namespace)
    return {"flushed": namespace}
