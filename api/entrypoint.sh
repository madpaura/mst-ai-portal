#!/bin/bash
set -e

# Fix ownership of mounted data volumes so appuser can write to them.
# Runs once as root before dropping privileges via gosu.
for dir in /data/videos /data/media /remotion-banner; do
    if [ -d "$dir" ]; then
        chown -R appuser:appgroup "$dir" 2>/dev/null || true
    fi
done

# Run database migrations before the backend starts.
# Only run from the backend (uvicorn) container — workers share this entrypoint
# but should not race to migrate.
if [[ "$1" == "uvicorn" ]]; then
    echo "[entrypoint] Running alembic upgrade head..."
    gosu appuser alembic upgrade head
    echo "[entrypoint] Migrations complete."
    # Uvicorn expects lowercase log level; default to info if LOG_LEVEL unset
    UVICORN_LOG_LEVEL=$(echo "${LOG_LEVEL:-info}" | tr '[:upper:]' '[:lower:]')
    # Number of worker processes. Default 1; set UVICORN_WORKERS to use more
    # cores. Each worker runs the app's lifespan, but the alembic migration and
    # the forge scheduler are guarded by Postgres advisory locks so they run
    # once regardless of worker count.
    UVICORN_WORKERS="${UVICORN_WORKERS:-1}"
    exec gosu appuser "$@" --log-level "$UVICORN_LOG_LEVEL" --workers "$UVICORN_WORKERS"
fi

exec gosu appuser "$@"
