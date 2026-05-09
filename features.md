# MST AI Portal — Feature Overview

High-level summary of all major features.

---

## Ignite — Video Learning Platform

- HLS adaptive-bitrate streaming (360p / 720p / 1080p quality ladder)
- Course and chapter organisation — courses contain ordered video lists; each video can have named chapters with timestamps
- AI auto-mode pipeline: upload a raw video and the system automatically generates a transcript, title/description, chapters, and a how-to guide via Whisper + Ollama LLM
- Manual chapter editor — admin marks chapters directly on the video timeline
- Closed captions — auto-generated WebVTT from Whisper transcript; styled with portal font
- Transcript viewer — full searchable transcript panel alongside the player
- GPU-accelerated transcoding with NVENC when an NVIDIA GPU is present; falls back to CPU libx264
- Video trim and cut tool — near-instant re-segment without full re-encode
- Course progress tracking per user
- Related videos sidebar

---

## Solutions

- Solution card showcase (categories: SW / HW / Other)
- Filterable single-select category buttons (matches Articles style)
- Cards display icon, title, short description, tags, and external link
- Admin CRUD with icon picker, category, and ordering

---

## Marketplace (Forge)

- Registry of agents, skills, and MCP servers
- GitHub repo sync — scans configured repositories for component directories, reads `skill.md` / `README.md`, extracts how-to guides from `skill.md` first, then HOWTO.md, then README sections
- Per-component how-to guide — displayed as rendered Markdown in a new tab; admin can also set an external URL that overrides the synced guide
- Zip download — clones the repo on-the-fly and packages the component directory
- Card view (4-column grid) and list view with inline description and action icons
- Filters by type (Agent / Skill / MCP Server) and verification badge
- Site-wide search integration (name + description + component type)
- Admin: create, edit, activate/deactivate, delete individual or all components; set contributing guide video; configure how-to URL

---

## Discover

- **Articles** — long-form knowledge articles with Markdown content, category filter, and search
- **Memes** — image gallery with titles and tags
- **News** — RSS-ingested news feed with external links and summaries

---

## Site-Wide Search

- Full-text search across all content: videos, articles, solutions, news, marketplace components
- Autocomplete suggestions in the Navbar search bar (top 10, prefix-aware)
- Dedicated `/search` results page with type filter tabs (All / Videos / Articles / Solutions / News / Marketplace)
- Highlighted match snippets using PostgreSQL `ts_headline`
- Paginated results (20 per page)
- Marketplace results link to `/marketplace?q={slug}` to pre-filter the page

---

## Admin Panel

- **Videos** — upload, transcode, manage courses, chapters, transcripts, auto-mode jobs
- **Solutions** — CRUD for solution cards
- **Articles** — CRUD for knowledge articles; AI beautify button
- **Memes** — upload and manage meme gallery
- **News** — manage RSS feeds and individual news items
- **Marketplace** — component registry management, GitHub sync jobs, contributing guide config
- **Forge Settings** — configure GitHub repo URL, token, branch, and scan paths for sync
- **Analytics** — page-view counts and trends
- **Digest** — schedule and send learning digest emails (curated content newsletter)
- **Settings** — SMTP configuration, portal theme, transcript service URL/key, marketplace under-construction toggle, SAML settings path

---

## Authentication & Roles

Three auth modes configured via `AUTH_MODE`:

| Mode | Description |
|---|---|
| `open` | Local username/password. Default admin seeded from `SEED_DEFAULT_ADMIN`. |
| `ldap` | Bind against corporate LDAP/AD with `LDAP_URL` + `LDAP_BASE_DN`. |
| `saml` | ADFS / SAML 2.0. AD group → portal role via `SAML_GROUP_ROLE_MAP`. |

Roles:

| Role | Access |
|---|---|
| `user` | View all published content |
| `content` | Upload videos, create articles, manage courses |
| `admin` | Full access including settings, analytics, delete, digest |

SAML users are auto-redirected to `/login` when unauthenticated. Sign Out is hidden in SAML mode.

---

## Themes

Two portal-wide themes, set by admin in Admin Settings:

- **Default** — glass/neon aesthetic with backdrop blur, primary-colour glows, and circuit-grid background patterns
- **Simple** — GitHub-inspired flat design; all shadows, glows, blurs, and decorative elements removed; solid cards and navbar

Both themes support light and dark mode toggle independently.

---

## Watcher — Auto Video Ingestion

- Monitors a filesystem path (e.g. Samba share) for new video files
- Automatically uploads and triggers processing when a new `.mp4` / `.webm` appears
- Configurable via `watcher.json`; runs as a systemd service or cron job

---

## Infrastructure

- **Redis** cache with configurable TTL for API responses (list endpoints, search suggestions)
- **Alembic** migrations run automatically on backend startup — safe to redeploy without manual migration steps
- **Resource limits** — all background worker containers have configurable CPU/memory caps so content serving is never starved
- **Backup** — `scripts/backup.sh` handles DB dump + video archive + config; supports local, rsync, scp, and rclone remote transfer with configurable retention
- **Live migration** — `scripts/migrate.sh` handles full server-to-server migration with automatic rollback on failure
