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
fi

exec gosu appuser "$@"
