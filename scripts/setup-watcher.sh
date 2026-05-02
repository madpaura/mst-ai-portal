#!/bin/bash
# MST AI Portal — Watcher setup
# Usage: ./scripts/setup-watcher.sh [--service]
#
#   --service   Also install & start the systemd service

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV="$REPO_DIR/venv"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

ok()     { echo -e "  ${GREEN}✔${NC} $1"; }
warn()   { echo -e "  ${YELLOW}⚠${NC} $1"; }
fail()   { echo -e "  ${RED}✘${NC} $1"; exit 1; }
header() { echo -e "\n${BLUE}── $1 ──${NC}"; }

INSTALL_SERVICE=false
for arg in "$@"; do [[ "$arg" == "--service" ]] && INSTALL_SERVICE=true; done

# ── 1. Install watchdog ────────────────────────────────────────────────────────
header "Dependencies"
if [[ -x "$VENV/bin/pip" ]]; then
    "$VENV/bin/pip" install -q "watchdog>=4.0"
    ok "watchdog installed in venv"
else
    warn "No venv found at $VENV — installing globally"
    pip install -q "watchdog>=4.0"
    ok "watchdog installed"
fi

# ── 2. Create watcher.json if missing ─────────────────────────────────────────
header "Config"
CONF="$REPO_DIR/watcher.json"
if [[ -f "$CONF" ]]; then
    ok "watcher.json already exists — not overwriting"
else
    # Read cached API URL/token from mst-ingest if available
    CACHED_URL="http://localhost:9800"
    CACHED_TOKEN=""
    AUTH_FILE="$HOME/.mst-ingest.json"
    if [[ -f "$AUTH_FILE" ]]; then
        CACHED_URL=$(python3 -c "import json; d=json.load(open('$AUTH_FILE')); print(d.get('api_url','http://localhost:9800'))" 2>/dev/null || echo "http://localhost:9800")
        CACHED_TOKEN=$(python3 -c "import json; d=json.load(open('$AUTH_FILE')); print(d.get('token',''))" 2>/dev/null || echo "")
    fi

    cat > "$CONF" <<EOF
{
  "watch_root":   "/mnt/samba/videos",
  "api_url":      "$CACHED_URL",
  "token":        "$CACHED_TOKEN",
  "username":     "",
  "password":     "",

  "max_size_mb":  100,
  "allowed_ext":  [".mp4", ".webm"],

  "mode":         "always",

  "auto_process": true,
  "transcode":    false,

  "stabilize_s":  15,
  "log_file":     "$REPO_DIR/watch.log"
}
EOF
    ok "Created watcher.json — edit watch_root before starting"
    warn "Set watch_root in $CONF to your Samba share mount point"
fi

# ── 3. Quick syntax check ──────────────────────────────────────────────────────
header "Syntax check"
python3 -c "
import sys; sys.path.insert(0,'$REPO_DIR')
import ast, pathlib
src = pathlib.Path('$REPO_DIR/watch.py').read_text()
ast.parse(src)
print('  watch.py OK')
"

# ── 4. Optionally install systemd service ─────────────────────────────────────
if [[ "$INSTALL_SERVICE" == true ]]; then
    header "systemd service"
    if [[ $EUID -ne 0 ]]; then
        fail "--service requires root: sudo $0 --service"
    fi

    # Patch the unit with the current user and repo path
    UNIT_SRC="$REPO_DIR/scripts/mst-watcher.service"
    UNIT_DST="/etc/systemd/system/mst-watcher.service"

    sed "s|/home/vishwa/mst-ai-portal|$REPO_DIR|g;s|User=vishwa|User=$(logname)|g" \
        "$UNIT_SRC" > "$UNIT_DST"

    systemctl daemon-reload
    systemctl enable --now mst-watcher
    ok "mst-watcher service enabled and started"
    echo ""
    echo "  Status : systemctl status mst-watcher"
    echo "  Logs   : journalctl -u mst-watcher -f"
fi

# ── Done ───────────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}  Ready.${NC}"
echo ""
echo "  Run once (test):    python watch.py --scan"
echo "  Run as daemon:      python watch.py"
echo "  Cron (daily 2am):   set \"mode\": \"02:00\" in watcher.json"
echo "  Install service:    sudo ./scripts/setup-watcher.sh --service"
echo ""
