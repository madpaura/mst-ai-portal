# MST AI Portal — Architecture

## System overview

```
Browser
  │
  ▼
Nginx (port 80/443)
  ├── /           → React frontend (static files)
  ├── /api/       → FastAPI backend (port 8000) — legacy path prefix
  ├── /backend/   → FastAPI backend (catch-all proxy; use VITE_API_URL=/backend for CORS-free same-origin access)
  ├── /assistant/ → FastAPI backend (SSE streaming, longer timeout)
  └── /streams/   → HLS video files (served from disk)

FastAPI backend
  ├── auth/          JWT (httpOnly cookie), LDAP, SAML 2.0; contributor request actions
  ├── video/         Ignite video + course CRUD, notes, progress; per-creator isolation
  ├── solutions/     Solution cards + news feed
  ├── articles/      Knowledge articles
  ├── marketplace/   Agent/skill/MCP registry (forge_components)
  ├── forge/         Digest scheduler, RSS ingest
  ├── assistant/     AI chat: SSE streaming, 21 role-gated tools, multi-provider LLM
  ├── publish/       Submit-for-review workflow; approve/decline via email action tokens
  ├── search/        Full-text + fuzzy trigram search (pg_trgm) across all content types
  ├── analytics/     Page-view tracking; meme click totals and per-meme breakdown
  └── settings/      Admin SMTP, portal config, assistant enable/disable, system prompt

Workers (separate containers)
  ├── transcoder      — Polls transcode_jobs, runs FFmpeg HLS pipeline; sends ready-to-publish email after encode if LLM jobs already finished
  └── auto-processor  — Transcript → metadata/chapters/howto via Ollama; sends ready-to-publish email after LLM jobs if transcode already finished

Transcript service (separate container)
  └── Whisper inference over SSE, job queue

SkillSpector sidecar (separate container)
  └── NVIDIA SkillSpector — LangGraph/YARA/LLM artifact security scanner; exposes POST /scan; used by artifacts validator for skill/MCP submissions

PostgreSQL — single database (mst_portal)
Redis      — cache + rate limiting
```

## Data flow: video upload to playback

```
1. Admin uploads MP4 → FastAPI writes raw file to /data/videos/{uuid}/raw/original.mp4
2. FastAPI inserts transcode_jobs row (status=pending)
3. Transcoder worker polls DB, claims job, runs FFmpeg:
   raw/original.mp4 → hls/{360p,720p,1080p}/*.ts + master.m3u8
4. Worker sets video status=ready, stores hls_path + thumbnail
5. Frontend loads HLS via hls.js, fetches /streams/{uuid}/hls/master.m3u8
6. Nginx serves .m3u8 and .ts segments directly from disk
```

## Data flow: auto-processing pipeline

```
1. Auto-mode trigger queues BOTH a transcode_job (HLS) AND auto_jobs (transcript/metadata/chapters/howto)
2. Transcoder and auto-processor run concurrently:
   a. Transcoder: raw/original.mp4 → HLS; sets status=ready; calls maybe_notify_owner_ready
   b. auto_processor: audio → transcript-service (Whisper over SSE) → metadata/chapters/howto LLM chain
3. Whichever finishes last calls maybe_notify_owner_ready which atomically checks both paths are done:
   - requires transcode done (status=ready) AND LLM jobs done AND auto_ready_notified=false
4. A single "ready to publish" email is sent to the creator, then auto_ready_notified is set to true
   (atomic claim in DB — exactly one email per video regardless of race)
```

## Data flow: publish authority

```
1. Content creator submits publish request (video or marketplace item) via portal UI
2. publish_requests row created; Publish Authority admins notified by email
3. Admin reviews via portal or one-click approve/decline in the email
   (signed action tokens — idempotent, GET /auth/contribute-request/action)
4. Creator notified by email on approve or decline
5. On approval: item status updated to published
```

## Directory layout

```
/data/videos/{uuid}/
├── raw/
│   ├── original.mp4        ← source file
│   ├── original_pretrim.mp4 ← backup before trim (if trimmed)
│   └── ops.json            ← operation audit log
├── hls/
│   ├── master.m3u8
│   ├── 360p/ 720p/ 1080p/  ← HLS segments
├── transcript.json
├── howto.json
└── thumb.jpg
```

## Key technology choices

| Layer | Choice | Reason |
|---|---|---|
| API | FastAPI + asyncpg | Async I/O, raw SQL (no ORM overhead), PostgreSQL native |
| Frontend | React 19 + Vite | Fast builds, lazy-loaded chunks, TypeScript |
| Video | FFmpeg + HLS | Browser-compatible adaptive bitrate, GPU via NVENC |
| Transcription | Whisper (faster-whisper) | Offline, accurate, SSE streaming progress |
| LLM | Ollama / OpenAI / Anthropic / OpenAI-compatible | Multi-provider; auto-mode uses Ollama; in-house gateway takes priority when enabled; assistant supports all four |
| Auth | JWT httpOnly cookie | XSS-safe; SAML/LDAP for enterprise SSO; SAML deep-link preserved via RelayState |
| Cache | Redis | Per-namespace versioned cache, TTL-based invalidation |
| Artifact security | NVIDIA SkillSpector sidecar | LangGraph/YARA/LLM scan of skill/MCP submissions; decoupled from API image |

## Database schema highlights

- `videos` — core video metadata, status, hls_path, thumbnail; `created_by` (owner UUID), `auto_ready_notified`
- `courses` + `video_chapters` — course structure, chapter timestamps; `courses.is_featured` (single-featured toggle for IgniteBrowse hero)
- `transcode_jobs` — worker queue with SKIP LOCKED
- `auto_jobs` — auto-processor queue (transcript/metadata/chapters/howto)
- `user_video_progress` — per-user watch position and completion
- `user_notes` — timestamped video notes
- `video_bookmarks` — per-user saved/bookmarked videos
- `playlists` + `playlist_videos` — user-created custom playlists with ordered video membership
- `articles` — knowledge base; `pdf_url` / `pdf_filename` for PDF-mode articles; `view_count` aggregated from analytics
- `article_likes` — one row per (user, article); used for like counts and trending score
- `solutions` + `news_items` — solutions showcase + feed
- `forge_components` — marketplace registry; `creator_user_id` tracks the submitting user for owner-gated controls
- `artifact_submissions` — contributor submissions pending review; `parent_slug` links updates to an existing component, `version_tag` records the target version
- `artifact_versions` — immutable snapshot of every published version (version string, timestamp, metadata)
- `publish_requests` — submit-for-review records (target_type, target_id, status, reviewer)
- `meme_clicks` — per-meme click log for redirect analytics (`/r/{meme_id}`)
- `app_settings` — key/value admin config (SMTP, feature flags, assistant system prompt, `assistant_enabled`, `artifact_allowed_types`, `inhouse_llm_config`)

## Security model

- All admin endpoints require `role=admin`; content endpoints require `role=content`
- Rate limiting via slowapi on auth endpoints (login: 5/min, reset: 10/min)
- httpOnly cookies — JS cannot read tokens
- Article HTML content sanitized server-side with bleach on write
- DB port bound to loopback only (127.0.0.1) in docker-compose
- SAML assertions verified via python3-saml
