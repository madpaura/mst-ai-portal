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
- **Per-creator isolation** — content creators see and manage only their own videos; admins see everything
- **Ready-to-publish email** — when auto-mode finishes all jobs, the creator receives an email with review and preview links (sent once per video)

### Browse & Discovery (IgniteBrowse)

`/ignite` is now a full discovery landing page; the player opens at `/ignite/:videoSlug`.

- **Featured-series hero** — admin-pinned featured course displayed prominently at the top
- **Dynamic category pills** — filter the video grid by category in one click
- **Discover modes** — Trending (view count), Top Rated (likes), Recently Added, Watch History, Saved
- **Continue Watching** — cards show playback progress bar; restores your last position from local cache
- **Playlists & Series row** — browse courses and custom playlists directly on the landing page
- **Left-panel Library** — Saved, Watch History, Subscribed courses, and custom Playlists; selecting any item scopes the grid exclusively
- **Fuzzy video search** — powered by Fuse.js; query persisted in the URL (`?q=`) so browser-back restores results; any sidebar selection clears search
- **Per-card controls** — bookmark (save for later) and add-to-playlist actions on every card
- **Uploader attribution** — creator name, view counts, and like counts shown on each card

### Custom Playlists

- Create, rename, and delete personal playlists
- Add / remove individual videos from any playlist
- Subscribed-courses view shows all enrolled courses alongside playlists

---

## Solutions

- Solution card showcase (categories: SW / HW / Other)
- Filterable single-select category buttons (matches Articles style)
- Cards display icon, title, short description, tags, and external link
- Admin CRUD with icon picker, category, and ordering

---

## Marketplace (Forge)

- Registry of agents, skills, and MCP servers
- GitHub repo sync — scans configured repositories for component directories, reads `skill.md` / `README.md`, extracts how-to guides from `skill.md` first, then HOWTO.md, then README sections; parses YAML folded/literal block scalars correctly
- Per-component how-to guide — displayed as rendered Markdown in a new tab; admin can also set an external URL that overrides the synced guide
- Zip download — clones the repo on-the-fly and packages the component directory; download counter increments on every ZIP and on install-command copy (deduped per session)
- Card view (4-column grid) and list view with inline description and action icons
- Filters by type (Agent / Skill / MCP Server) and verification badge
- Site-wide search integration (name + description + component type)
- **Install CMD tab** — shows the full install command for the component; uses `npx skills add <owner/repo> --skill <slug> --agent claude-code --global --yes` for skills, `~/.claude/agents/` path for agents, and `claude mcp add` / `mcp.json` instructions for MCP servers (auto-generated from the configured GitHub repo URL)
- Admin: create, edit, activate/deactivate, delete individual or all components; set contributing guide video; configure how-to URL

### Artifact Contributions

- Contributors submit new agents, skills, or MCP servers via the **Artifact Hub** submission form
- **Type picker** — clicking `+New` opens a type-confirm step (Agent / Skill / MCP) before the form; the chosen type is shown as a confirmed chip with a Change action
- **Admin-controlled allowed types** — admins configure which artifact types contributors may submit from the GitHub config panel; disallowed types are hidden from the picker and rejected server-side
- Submissions go through the Publish Authority review queue; admins can approve directly without queue
- **Submit Update** — component owner or admin can submit a version update by linking to the existing component via `parent_slug`; the slug and type fields are locked and a version tag field is required
- **Soft-delete** — component owner or any admin can remove a published component via a Delete button on the marketplace card

### Artifact Lifecycle & Version History

- **Version tagging** — each publish specifies a bump type (major / minor / patch) with a next-version preview; first publish defaults to `1.0.0`
- **Version history tab** — every publish snapshots into `artifact_versions`; the artifact detail panel shows a read-only timeline of all past versions with dates
- **GitHub integration** — publishing writes files to the configured GitHub repo; deleting a published artifact also removes its GitHub folder, drops its entry from the repo-root `MANIFEST.json` + `README.md`, and deactivates the marketplace card (`force=true` escape hatch if GitHub cleanup fails)
- **MANIFEST.json & README.md** — publishing maintains a repo-root `MANIFEST.json` (keyed by type) and `README.md` Contents list in the madpaura/skills reference format; all entries kept in sync on every publish or delete
- **LLM-generated About** — the artifact's `long_description` is rewritten via LLM into a friendly Markdown-formatted blurb (≤200 words); regenerated only when the source content changes (tracked by `source_hash` + `ABOUT_PROMPT_VERSION`); falls back to raw text if LLM is unavailable
- **Type-aware install guides** — `api/howto_guides.py` produces standard Install / Verify / Update / Remove guides tailored to each artifact type; auto-populated when no guide is found in the repo

---

## Discover

- **Articles** — long-form knowledge articles with Markdown content, category filter, and search
- **Memes** — image gallery with titles and tags; public short-link redirect (`/r/{meme_id}`) with click logging; analytics showing daily click totals and per-meme breakdown in the Admin Analytics panel
- **News** — RSS-ingested news feed with external links and summaries

---

## Site-Wide Search

- Full-text search across all content: videos, articles, solutions, news, marketplace components
- **Fuzzy typo-tolerant search** — `pg_trgm` trigram GIN indexes + `word_similarity()` fallback (threshold 0.25) catch spelling mistakes; combined ranking via `GREATEST(ts_rank * 1.5, trgm_score)`
- `websearch_to_tsquery` replaces `plainto_tsquery` for phrase and prefix-aware matching
- Autocomplete suggestions in the Navbar search bar (top 10, prefix-aware)
- Dedicated `/search` results page with type filter tabs (All / Videos / Articles / Solutions / News / Marketplace)
- Highlighted match snippets using PostgreSQL `ts_headline`
- Paginated results (20 per page)
- Marketplace results link to `/marketplace?q={slug}` to pre-filter the page

---

## Admin Panel

- **Videos** — upload, transcode, manage courses, chapters, transcripts, auto-mode jobs; user search/filter; single-featured course toggle
- **Solutions** — CRUD for solution cards
- **Articles** — CRUD for knowledge articles; AI beautify button
- **Memes** — upload and manage meme gallery
- **News** — manage RSS feeds and individual news items
- **Marketplace** — component registry management, GitHub sync jobs, contributing guide config; configure allowed artifact types per contributor
- **Forge Settings** — configure GitHub repo URL, token, branch, and scan paths for sync
- **Analytics** — page-view counts and trends; **Memes tab** with daily click totals and per-meme breakdown
- **Digest** — schedule and send learning digest emails (curated content newsletter)
- **Settings** — SMTP configuration (including subject prefix), portal theme, transcript service URL/key, marketplace under-construction toggle, SAML settings path, **AI assistant enable/disable**, **assistant system prompt**
- **Publish Authority** — review submit-for-publish requests from content creators; one-click approve/decline via portal UI or email action links
- **Artifact Hub** — manage contributor submissions; approve or reject with version tagging; view per-artifact version history

---

---

## AI Assistant

- Floating chat widget available on all non-admin pages; slides in from the bottom-right corner
- **SSE streaming** — response tokens arrive in real time via Server-Sent Events
- **21 role-gated tools** covering: search/list videos and courses, article/solution/marketplace search, user learning progress, personal notes, announcements, news feed, global search, pending publish requests, artifact submissions, and job status
- **Multi-provider LLM** — supports Ollama, OpenAI, and Anthropic via a unified tool-calling loop; configured in Admin → Forge Settings
- **Rolling history compaction** — client sends the last 20 messages to `/assistant/compact` when the window fills; older context is summarised and injected as a system message
- **Admin controls** — enable/disable the assistant site-wide via Admin → Settings; configure a custom system prompt injected before every chat
- `/assistant/enabled` endpoint lets the widget check its own state before rendering

---

## Publish Authority

- Content creators submit videos or marketplace items for publish via a "Request Publish" button
- A designated group of **Publish Authority** admins receives an email with one-click **Approve** / **Decline** action links (signed tokens, idempotent)
- The creator is notified by email when the request is decided (approved or declined, with optional reviewer notes)
- Requests are listed in Admin → Publish Authority with full status history
- Only Publish Authority admins (not all admins) receive the review notification emails

---

## Email Notifications

- **Subject prefix** — every outgoing email is prefixed with a configurable label (default `MSTAI-TF`); overridable in Admin → Settings → SMTP or via `EMAIL_SUBJECT_PREFIX` env var; blank disables
- **Contributor request** — admins and the applicant are notified on submission; both are notified on admin decision (approve/decline) with one-click email action buttons
- **Marketplace submission** — submitter notified when an admin approves or rejects their artifact
- **Ready to publish** — creator notified once by email when auto-mode pipeline finishes all jobs; links directly to the review and preview pages
- **Publish Authority review** — Publish Authority admins notified when a creator submits a publish request (see above)

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

**Token-driven CSS variable system** — colour is defined once per semantic role via ~20 CSS custom properties (surfaces, 4-rank text, borders, brand, state + subtle fills) in `index.css`. Dark mode is a variable flip, not a cascade of `dark:` prefixes. Brand tokens use RGB channels so Tailwind opacity modifiers (`bg-primary/10`, `border-accent/20`) resolve correctly. See `react-portal/THEMING.md` for the full vocabulary.

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
- **Unified log level** — `LOG_LEVEL` env var (`DEBUG` / `INFO` / `WARNING` / `ERROR`) applied consistently to backend, worker, auto-processor, and uvicorn access logs
- **Host networking mode** — `HOST_NETWORK=true` + `docker-compose.hostnet.yml` override switches all containers to `network_mode: host`; useful when the Docker bridge network causes Ollama or LDAP connectivity issues (Linux only)
- **Same-origin API proxy** — nginx `/backend/` location strips the prefix and forwards to the backend, allowing `VITE_API_URL=/backend` for CORS-free access regardless of port layout
