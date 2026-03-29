#!/bin/bash
# Deploy api-ts to EC2 via rsync + systemd
# Usage: ./scripts/deploy-api-ts.sh [prod|dev]
set -euo pipefail

ENV="${1:-prod}"
KEY="$HOME/.ssh/suwappu-bot-key"

if [ "$ENV" = "prod" ]; then
  HOST="${EC2_HOST_PROD:?Set EC2_HOST_PROD env var or GitHub secret}"
elif [ "$ENV" = "dev" ]; then
  HOST="${EC2_HOST_DEV:?Set EC2_HOST_DEV env var or GitHub secret}"
else
  echo "Usage: ./scripts/deploy-api-ts.sh [prod|dev]"
  exit 1
fi

if [ ! -f "$KEY" ]; then
  echo "SSH key not found at $KEY"
  exit 1
fi

SSH="ssh -i $KEY -o StrictHostKeyChecking=no -o ConnectTimeout=10 -o LogLevel=ERROR"
REMOTE="ubuntu@$HOST"
DEST="/home/ubuntu/suwappubot/api-ts"

echo "=== Deploying api-ts to $HOST ==="

# Ensure bun is installed on remote
$SSH $REMOTE "bash -s" <<'SETUP'
if ! command -v /home/ubuntu/.bun/bin/bun &>/dev/null; then
  echo "Installing bun..."
  curl -fsSL https://bun.sh/install | bash
fi
echo "bun: $(/home/ubuntu/.bun/bin/bun --version)"
SETUP

# Rsync api-ts directory (exclude node_modules, .env, dist)
echo "=== Syncing files ==="
rsync -az --delete \
  --exclude='node_modules' \
  --exclude='.env' \
  --exclude='dist' \
  --exclude='.next' \
  --exclude='dashboard/dist' \
  -e "$SSH" \
  "$(dirname "$0")/../api-ts/" \
  "$REMOTE:$DEST/"

# Install deps, set up service, restart
echo "=== Installing deps + restarting ==="
$SSH $REMOTE "bash -s" <<'DEPLOY'
set -euo pipefail
export PATH="/home/ubuntu/.bun/bin:$PATH"
cd /home/ubuntu/suwappubot/api-ts

echo "Installing dependencies..."
bun install 2>&1 | tail -3

echo "Setting up systemd service..."
sudo cp suwappu-api-ts.service /etc/systemd/system/suwappu-api-ts.service
sudo systemctl daemon-reload
sudo systemctl enable suwappu-api-ts
sudo systemctl restart suwappu-api-ts
sleep 5

echo "=== Health check ==="
for i in 1 2 3 4 5; do
  H=$(curl -sf http://localhost:8000/health 2>/dev/null || echo '{"status":"starting"}')
  echo "  [$i] $H"
  echo "$H" | grep -q '"healthy"' && echo "Deploy OK!" && exit 0
  sleep 3
done
echo "WARNING: Health check didn't pass yet. Check logs:"
echo "  sudo journalctl -u suwappu-api-ts -n 20 --no-pager"
DEPLOY
