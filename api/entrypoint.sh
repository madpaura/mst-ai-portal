#!/bin/bash
set -e

# Fix ownership of mounted data volumes so appuser can write to them.
# Runs once as root before dropping privileges via gosu.
for dir in /data/videos /data/media /remotion-banner; do
    if [ -d "$dir" ]; then
        chown -R appuser:appgroup "$dir" 2>/dev/null || true
    fi
done

# The mmrag SSH key is mounted read-only and is normally owned by the host user
# with mode 600, so appuser gets its own private copy.
if [ -d /secrets/mmrag-ssh ]; then
    install -d -m 700 -o appuser -g appgroup /run/mmrag-ssh
    for file in id_ed25519 known_hosts; do
        if [ -f "/secrets/mmrag-ssh/$file" ]; then
            install -m 600 -o appuser -g appgroup "/secrets/mmrag-ssh/$file" "/run/mmrag-ssh/$file"
        fi
    done
fi

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
