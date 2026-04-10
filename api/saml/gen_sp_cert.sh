#!/usr/bin/env bash
# Generate SP self-signed certificate for SAML request signing.
# Run once on the app server. Give sp.crt to your AD admin.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CERTS_DIR="$SCRIPT_DIR/certs"
mkdir -p "$CERTS_DIR"

CN="${SP_CN:-mst-ai-portal.ai.x.net}"

openssl req -x509 -newkey rsa:2048 \
  -keyout "$CERTS_DIR/sp.key" \
  -out    "$CERTS_DIR/sp.crt" \
  -days 1825 -nodes \
  -subj "/C=KR/O=Samsung DS/CN=$CN"

# Strip PEM headers → bare base64 for settings.json / env vars
grep -v "CERTIFICATE" "$CERTS_DIR/sp.crt" | tr -d '\n' > "$CERTS_DIR/sp.crt.b64"
grep -v "PRIVATE KEY"  "$CERTS_DIR/sp.key" | tr -d '\n' > "$CERTS_DIR/sp.key.b64"

chmod 600 "$CERTS_DIR/sp.key" "$CERTS_DIR/sp.key.b64"

echo ""
echo "✅  SP certificate generated:"
echo "    Public cert : $CERTS_DIR/sp.crt"
echo "    Private key : $CERTS_DIR/sp.key"
echo ""
echo "→  Give sp.crt to your AD admin (they upload it to the Relying Party Trust)."
echo "→  Copy sp.crt.b64 → SAML_SP_CERT in .env  (or into settings.json sp.x509cert)"
echo "→  Copy sp.key.b64 → SAML_SP_KEY  in .env  (or into settings.json sp.privateKey)"
