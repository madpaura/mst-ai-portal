# MST AI Portal — Implementation Task Plan

## Phase 1: Backend Foundation ✅
- [x] 1.1 Create FastAPI project structure (`api/`)
- [x] 1.2 Config module (`config.py`) — env vars, paths, AUTH_MODE toggle
- [x] 1.3 Database module (`database.py`) — async PG pool via asyncpg
- [x] 1.4 DB init script (`db/init.sql`) — all tables + seed data
- [x] 1.5 Docker Compose for PostgreSQL (dev mode)

## Phase 2: Authentication ✅
- [x] 2.1 Auth schemas (Pydantic models)
- [x] 2.2 Auth service — open mode (username/password, JWT generation, bcrypt)
- [x] 2.3 Auth dependencies — JWT validation, role extraction, optional user
- [x] 2.4 Auth router — login, logout, me, update profile
- [x] 2.5 Admin guard dependency (require role=admin)
- [x] 2.6 Seed admin user on startup (auth/seed.py)

## Phase 3: Video / Ignite Backend ✅
- [x] 3.1 Video schemas (15+ Pydantic models)
- [x] 3.2 Video public router — courses, videos, chapters, progress, notes, howto
- [x] 3.3 Admin video router — CRUD, upload, publish, chapters, howto, quality, thumbnail, seed notes
- [x] 3.4 Transcode worker — FFmpeg job queue (poll PG, SKIP LOCKED, retry, multi-bitrate HLS)
- [x] 3.5 Course admin router — CRUD with video count validation

## Phase 4: Forge / Marketplace Backend ✅
- [x] 4.1 Forge schemas
- [x] 4.2 Forge public router — list, detail, categories, install tracking, full-text search
- [x] 4.3 Admin forge router — CRUD, activate/deactivate

## Phase 5: Solutions Backend ✅
- [x] 5.1 Solutions router — capabilities, announcements, contact form

## Phase 6: Frontend — Admin Pages ✅
- [x] 6.1 Admin layout component (header with nav, auth guard, Outlet)
- [x] 6.2 Admin video management page (list, upload, metadata, chapters, howto, quality, seed notes, publish)
- [x] 6.3 Admin marketplace catalog page (table, create/edit slide-out form, icon picker, activate/deactivate)
- [x] 6.4 Admin routing in App.tsx (`/admin/*`) with nested routes

## Phase 7: Frontend — API Integration ✅
- [x] 7.1 API client utility (fetch wrapper with Bearer token, upload helper)
- [x] 7.2 Auth context + login page
- [x] 7.3 Navbar wired to auth (sign in, admin panel, sign out)
- [x] 7.4 Solutions page → backend (capabilities, announcements)
- [x] 7.5 Marketplace page → backend (forge components, categories, install tracking, search/filter)
- [x] 7.6 IgniteSidebar → backend (video courses, video list from API with fallback)
- [x] 7.7 Ignite page → backend (chapters, notes CRUD, howto guides)
- [x] 7.8 Howto page cleaned up (uses shared sidebar data)

## Phase 8: Validation ✅
- [x] 8.1 Backend: all endpoints respond correctly (tested via curl)
- [x] 8.2 Frontend: TypeScript compiles clean (`tsc --noEmit` + `vite build`)
- [x] 8.3 Full stack: PostgreSQL up, API running with seed data, frontend dev server running
- [x] 8.4 Verified: login, create video, create forge component, all CRUD endpoints
- [x] 8.5 Fix: bcrypt compatibility (passlib → direct bcrypt), unused imports cleaned

## Running Services
- **PostgreSQL**: `docker-compose up -d db` (port 5432)
- **FastAPI API**: `cd api && source venv/bin/activate && uvicorn main:app --reload` (port 8000)
- **React Frontend**: `cd react-portal && npm run dev` (port 5173)
- **Swagger UI**: http://localhost:8000/docs
