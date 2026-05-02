#!/bin/bash
# MST AI Portal — nginx setup & reload script
# Usage: sudo ./scripts/setup-nginx.sh [--rebuild]
#
#   --rebuild   Also rebuild & restart docker containers after updating .env
#               (needed the first time so VITE_API_URL=/backend is baked in)

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NGINX_CONF="$REPO_DIR/nginx/mst-ai-portal.conf"
SITE_NAME="mst-ai-portal"
SITES_AVAILABLE="/etc/nginx/sites-available/$SITE_NAME"
SITES_ENABLED="/etc/nginx/sites-enabled/$SITE_NAME"
ENV_FILE="$REPO_DIR/.env"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

ok()     { echo -e "  ${GREEN}✔${NC} $1"; }
warn()   { echo -e "  ${YELLOW}⚠${NC} $1"; }
fail()   { echo -e "  ${RED}✘${NC} $1"; exit 1; }
header() { echo -e "\n${BLUE}── $1 ──${NC}"; }

REBUILD=false
for arg in "$@"; do [[ "$arg" == "--rebuild" ]] && REBUILD=true; done

# ── Root check ─────────────────────────────────────────────────────────────
if [[ $EUID -ne 0 ]]; then
    fail "Run as root: sudo $0 $*"
fi

# ── 1. Install nginx if missing ────────────────────────────────────────────
header "nginx"
if command -v nginx &>/dev/null; then
    ok "nginx already installed ($(nginx -v 2>&1 | awk '{print $3}'))"
else
    warn "nginx not found — installing..."
    apt-get update -qq && apt-get install -y -qq nginx
    ok "nginx installed"
fi

# ── 2. Deploy site config ──────────────────────────────────────────────────
header "Site config"
cp "$NGINX_CONF" "$SITES_AVAILABLE"
ok "Copied → $SITES_AVAILABLE"

# Enable site
if [[ ! -L "$SITES_ENABLED" ]]; then
    ln -s "$SITES_AVAILABLE" "$SITES_ENABLED"
    ok "Enabled → $SITES_ENABLED"
else
    ok "Already enabled"
fi

# Disable default site if it exists (avoids port 80 conflict)
if [[ -L /etc/nginx/sites-enabled/default ]]; then
    rm /etc/nginx/sites-enabled/default
    warn "Removed default nginx site (was catching port 80)"
fi

# ── 3. Update .env ──────────────────────────────────────────────────────────
header ".env"

set_env() {
    local key="$1" val="$2"
    if grep -q "^${key}=" "$ENV_FILE" 2>/dev/null; then
        sed -i "s|^${key}=.*|${key}=${val}|" "$ENV_FILE"
        ok "Updated ${key}=${val}"
    else
        echo "${key}=${val}" >> "$ENV_FILE"
        ok "Added   ${key}=${val}"
    fi
}

# Frontend must call API via nginx path so the browser reaches it correctly
set_env "VITE_API_URL"  "/backend"
# Email links should use the public hostname
set_env "PORTAL_URL"    "http://mst.ai.samsungds.net"

# ── 4. Test nginx config ───────────────────────────────────────────────────
header "Config test"
if nginx -t 2>&1; then
    ok "nginx config OK"
else
    fail "nginx config test failed — fix errors above and re-run"
fi

# ── 5. Reload nginx ────────────────────────────────────────────────────────
header "Reload"
if systemctl is-active --quiet nginx; then
    systemctl reload nginx
    ok "nginx reloaded"
else
    systemctl enable --now nginx
    ok "nginx started and enabled"
fi

# ── 6. Optionally rebuild docker containers ────────────────────────────────
if [[ "$REBUILD" == true ]]; then
    header "Docker rebuild"
    cd "$REPO_DIR"

    # Load env so VITE_API_URL and PORTAL_URL are available to docker compose
    set -a; source "$ENV_FILE"; set +a

    warn "Rebuilding frontend container (VITE_API_URL=$VITE_API_URL)..."
    docker compose build --no-cache react-portal
    docker compose up -d
    ok "Containers rebuilt and running"
else
    echo ""
    warn "VITE_API_URL was updated in .env."
    warn "Rebuild the frontend container for the change to take effect:"
    echo ""
    echo "    sudo docker compose build --no-cache react-portal && sudo docker compose up -d"
    echo ""
fi

# ── Done ───────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}  Portal is live at: http://mst.ai.samsungds.net${NC}"
echo -e "  Backend API:       http://mst.ai.samsungds.net/backend/"
echo ""
