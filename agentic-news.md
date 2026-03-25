Let me understand your setup better before designing this:Good choices — let me build the full system now. Here's what I'm building:

**Architecture:**
- `news_agent.py` — Agentic pipeline: search → pick top 2 → fetch full content → generate markdown + images → save to disk → write DB entry
- `routers/news.py` — FastAPI router: trigger endpoint + serve articles + list entries
- `NewsSection.jsx` — React component for your site's news section (warm Claude.ai style)Here's what was built and how the pieces connect:

---

**`news_agent.py` — the agentic pipeline**

Six sequential steps, each as a separate function:
1. `pick_top_articles()` — Claude with `web_search` tool searches for AI news, reasons over results, and outputs the top 2 as JSON
2. `fetch_article_text()` — raw HTTP fetch + HTML stripping (no headless browser needed)
3. `generate_markdown()` — Claude writes a structured 400–600 word article with YAML front-matter, H2 sections, and `IMAGE:<query>` placeholders
4. `resolve_images()` — a second Claude pass with web search fills each placeholder with a real Unsplash/Wikimedia URL
5. `save_to_disk()` — writes `content/news/<slug>.md`
6. `save_to_db()` — inserts only the lightweight entry (slug, title, source, summary, tags, file_path) into Postgres

**`routers/news.py` — FastAPI endpoints**

| Method | Path | What it does |
|--------|------|-------------|
| `POST` | `/api/news/run-agent` | Fires the agent as a background task |
| `GET` | `/api/news/status` | Polls agent state (idle/running/done/error) |
| `GET` | `/api/news` | Paginated DB entries; `?tag=` filter supported |
| `GET` | `/api/news/{slug}` | Single entry metadata |
| `GET` | `/api/news/{slug}/content` | Full markdown from disk |

**`NewsSection.jsx` — React component**

Warm Claude.ai-style (off-white, Lora serif, terracotta accent). Features: sticky header with **Refresh News** button, tag filter pill strip, skeleton loading cards, featured first-article layout, and a modal that fetches + renders the full markdown only when clicked.

**To wire it up:**
```bash
# 1. DB migration
psql yourdb < migration.sql

# 2. Python deps
pip install -r requirements.txt

# 3. Register router in your FastAPI app.py
from routers.news import router as news_router
app.include_router(news_router)

# 4. React deps
npm install react-markdown remark-gfm

# 5. Drop NewsSection into your page
import NewsSection from './NewsSection'
```

Update `DB_DSN` in `news_agent.py` and `VITE_API_URL` in your `.env` and it's ready to run.