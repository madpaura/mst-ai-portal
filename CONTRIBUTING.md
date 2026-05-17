# Contributing to MST AI Portal

## Development setup

```bash
cp .env.example .env   # edit as needed
./run.sh init          # create venv, install deps, init DB
./run.sh start         # start all services (backend, frontend, worker)
```

See [SETUP.md](SETUP.md) for full setup instructions and [CLAUDE.md](CLAUDE.md) for codebase conventions.

## Making changes

### Backend (FastAPI / Python)

- Code lives in `api/`
- Add DB columns via Alembic migration in `api/alembic/versions/NNNN_description.py` — always use `IF NOT EXISTS` guards
- Use `db = await get_db()` for all DB access (raw SQL via asyncpg, no ORM)
- Mount new routers in `api/main.py`
- Admin endpoints go under `/admin` prefix and require `require_admin` or `require_content` dependency

### Frontend (React / TypeScript)

- Code lives in `react-portal/src/`
- Use the typed API wrapper: `api.get<T>('/path')`, `api.post(...)`, etc. (see `src/api/client.ts`)
- Use `catch (err: unknown)` — never `catch (err: any)` — and call `toApiError(err)` to extract the message
- New admin pages: add to `App.tsx` (lazy import), `AdminLayout.tsx` nav link, new page file

### Tests

Run the backend test suite:
```bash
cd api
source venv/bin/activate
python -m pytest tests/ -v
```

Tests live in `api/tests/`. Use `unittest.mock` for patching; avoid hitting real services.

## Commit style

- Conventional commits: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`
- Keep commits focused — one logical change per commit
- Always run `./run.sh start` and verify the affected feature before committing

## Pull requests

1. Branch from `main`
2. Keep PRs small and focused
3. Include a test or manual verification step in the PR description
4. Use `gh pr create` to open the PR (gh CLI is configured)

## Docker build check

Before pushing, verify the Docker build passes:

```bash
docker compose build
```

Or for the full stack:
```bash
./setup.sh deploy
```
