#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DESKTOP_DIR="$(dirname "$SCRIPT_DIR")"
WEBAPP_DIR="$(dirname "$DESKTOP_DIR")/webapp"

echo "Building webapp for desktop..."

# Build the webapp with production API URL and desktop-specific env
cd "$WEBAPP_DIR"
VITE_API_URL=https://api.suwappu.bot \
VITE_TURNKEY_RP_ID=app.suwappu.bot \
  npm run build

# Copy built assets to desktop dist
rm -rf "$DESKTOP_DIR/dist/webapp"
mkdir -p "$DESKTOP_DIR/dist/webapp"
cp -r "$WEBAPP_DIR/dist/"* "$DESKTOP_DIR/dist/webapp/"

# Strip Telegram Web App script from index.html (not needed on desktop)
sed -i.bak '/<script src="https:\/\/telegram.org\/js\/telegram-web-app.js"><\/script>/d' \
  "$DESKTOP_DIR/dist/webapp/index.html"
rm -f "$DESKTOP_DIR/dist/webapp/index.html.bak"

echo "Webapp built and copied to desktop/dist/webapp/"
echo "Telegram script stripped from index.html."
