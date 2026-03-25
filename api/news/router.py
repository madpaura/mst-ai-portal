"""
FastAPI router for agentic news system
Integrates with existing MST AI Portal news system
"""

import asyncio
import json
from datetime import datetime
from pathlib import Path
from typing import Optional, List

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query, Depends
from pydantic import BaseModel

from auth.dependencies import require_admin
from database import get_db
from news_agent import run_agent, CONTENT_DIR
from news_search import search_ai_news, search_news_by_query

router = APIRouter(prefix="/api/news", tags=["news"])

# ── In-memory agent status (replace with Redis for multi-worker setups) ───────
_agent_status: dict = {"state": "idle", "last_run": None, "last_articles": []}

# ── Pydantic models ───────────────────────────────────────────────────────────

class NewsEntry(BaseModel):
    id: str
    slug: Optional[str] = None
    title: str
    summary: str
    content: Optional[str] = None
    source: str
    source_url: Optional[str] = None
    badge: Optional[str] = None
    tags: List[str] = []
    is_active: bool = True
    published_at: datetime
    created_at: datetime

class AgentRunResponse(BaseModel):
    message: str
    state: str
    articles_processed: Optional[int] = None

class AgentStatus(BaseModel):
    state: str                  # idle | running | done | error
    last_run: Optional[datetime]
    last_articles: List[str]

# ── Routes ───────────────────────────────────────────────────────────────

@router.post("/run-agent", response_model=AgentRunResponse)
async def trigger_news_agent(
    background_tasks: BackgroundTasks,
    admin: dict = Depends(require_admin)
):
    """Trigger the agentic news pipeline to fetch and generate news articles."""
    
    if _agent_status["state"] == "running":
        return AgentRunResponse(
            message="Agent is already running",
            state="running"
        )
    
    # Update status
    _agent_status["state"] = "running"
    _agent_status["last_run"] = datetime.now()
    
    # Run agent in background
    async def run_and_update():
        try:
            result = await run_agent()
            _agent_status["state"] = result["status"]
            if result["status"] == "success":
                _agent_status["last_articles"] = [
                    r.get("title", "Unknown") for r in result.get("results", [])
                ]
            else:
                _agent_status["last_articles"] = []
        except Exception as e:
            _agent_status["state"] = "error"
            _agent_status["last_articles"] = []
    
    background_tasks.add_task(run_and_update)
    
    return AgentRunResponse(
        message="News agent started",
        state="running"
    )

@router.get("/status", response_model=AgentStatus)
async def get_agent_status():
    """Get the current status of the news agent."""
    return AgentStatus(
        state=_agent_status["state"],
        last_run=_agent_status["last_run"],
        last_articles=_agent_status["last_articles"]
    )

@router.get("/content/{slug}")
async def get_news_content(slug: str):
    """Get the full markdown content for a news article."""
    
    # First try to get from database
    db = await get_db()
    row = await db.fetchrow(
        "SELECT file_path FROM news_feed WHERE slug = $1 AND is_active = true",
        slug
    )
    
    if not row:
        raise HTTPException(status_code=404, detail="Article not found")
    
    # Read markdown file
    file_path = Path(row["file_path"])
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Content file not found")
    
    content = file_path.read_text(encoding='utf-8')
    
    # Extract just the markdown content (remove YAML frontmatter)
    if content.startswith('---'):
        parts = content.split('---', 2)
        if len(parts) >= 3:
            return {"content": parts[2].strip()}
    
    return {"content": content}

@router.get("/agentic", response_model=List[NewsEntry])
async def list_agentic_news(
    limit: int = Query(10, ge=1, le=50),
    tag: Optional[str] = None
):
    """List only agentic (AI-generated) news articles."""
    
    db = await get_db()
    
    query = """
        SELECT id, slug, title, summary, content, source, source_url, badge,
               tags, is_active, published_at, created_at
        FROM news_feed 
        WHERE source = 'llm' AND is_active = true
    """
    params = []
    
    if tag:
        query += " AND $2 = ANY(tags)"
        params = [limit, tag]
    else:
        params = [limit]
    
    query += " ORDER BY published_at DESC LIMIT $1"
    
    rows = await db.fetch(query, *params)
    
    return [
        NewsEntry(
            id=str(row["id"]),
            slug=row["slug"],
            title=row["title"],
            summary=row["summary"],
            content=row["content"],
            source=row["source"],
            source_url=row["source_url"],
            badge=row["badge"],
            tags=row["tags"] or [],
            is_active=row["is_active"],
            published_at=row["published_at"],
            created_at=row["created_at"]
        )
        for row in rows
    ]

# ── Integration with existing news system ───────────────────────────────────────

@router.get("/refresh")
async def refresh_news_feed(
    background_tasks: BackgroundTasks,
    admin: dict = Depends(require_admin)
):
    """Trigger news agent and return to existing news format."""
    
    # Trigger the agent
    await trigger_news_agent(background_tasks, admin)
    
    return {"message": "News refresh started, articles will appear in main news feed"}

@router.get("/search")
async def search_news(
    query: Optional[str] = Query(None, description="Search query for specific news"),
    days_back: int = Query(7, ge=1, le=30, description="Number of days to look back"),
    limit: int = Query(20, ge=1, le=100, description="Maximum number of results")
):
    """Search for AI news articles from RSS feeds."""
    
    try:
        if query:
            articles = await search_news_by_query(query, limit)
        else:
            articles = await search_ai_news(days_back=days_back, limit=limit)
        
        return {
            "query": query,
            "days_back": days_back,
            "limit": limit,
            "count": len(articles),
            "articles": articles
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Search failed: {str(e)}")
