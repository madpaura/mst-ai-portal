#!/bin/bash
set -e

# Fix ownership of mounted data volumes so appuser can write to them.
# Runs once as root before dropping privileges via gosu.
for dir in /data/videos /data/media /remotion-banner; do
    if [ -d "$dir" ]; then
        chown -R appuser:appgroup "$dir" 2>/dev/null || true
    fi
done

exec gosu appuser "$@"
