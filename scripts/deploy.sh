#!/bin/bash
# Deploy suwappubot to EC2 via SSH
# Usage: ./scripts/deploy.sh [prod|dev]
set -euo pipefail

ENV="${1:-prod}"
KEY="$HOME/.ssh/suwappu-bot-key"

if [ "$ENV" = "prod" ]; then
  HOST="${EC2_HOST_PROD:?Set EC2_HOST_PROD env var or GitHub secret}"
  BRANCH="main"
  SECRETS_SCRIPT="scripts/pull-secrets.sh"
elif [ "$ENV" = "dev" ]; then
  HOST="${EC2_HOST_DEV:?Set EC2_HOST_DEV env var or GitHub secret}"
  BRANCH="dev"
  SECRETS_SCRIPT="scripts/pull-secrets-dev.sh"
else
  echo "Usage: ./scripts/deploy.sh [prod|dev]"
  exit 1
fi

if [ ! -f "$KEY" ]; then
  echo "SSH key not found at $KEY"
  exit 1
fi

echo "Deploying $BRANCH to $HOST..."

ssh -T -i "$KEY" -o StrictHostKeyChecking=no -o ConnectTimeout=10 -o LogLevel=ERROR ubuntu@"$HOST" "bash -s" <<DEPLOY
set -euo pipefail
cd /home/ubuntu/suwappubot

echo "=== Pull $BRANCH ==="
git fetch origin
git checkout $BRANCH 2>/dev/null || git checkout -b $BRANCH origin/$BRANCH
git reset --hard origin/$BRANCH

echo "=== Deps ==="
./venv/bin/pip install -r requirements.txt -q 2>&1 | tail -3

echo "=== Secrets ==="
sudo bash $SECRETS_SCRIPT

echo "=== Restart ==="
sudo cp suwappubot.service /etc/systemd/system/suwappubot.service
sudo systemctl daemon-reload
sudo systemctl restart suwappubot
sleep 15

echo "=== Health ==="
for i in 1 2 3 4 5 6 7 8 9 10; do
  H=\$(curl -sf http://localhost:10000/health 2>/dev/null || echo '{}')
  S=\$(echo "\$H" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status','?'), d.get('bot','?'), d.get('database','?'))" 2>/dev/null || echo "? ? ?")
  echo "  [\$i] \$S"
  echo "\$S" | grep -q "healthy polling connected" && echo "Deploy OK!" && exit 0
  sleep 5
done
echo "FAILED"; sudo journalctl -u suwappubot --no-pager -n 30; exit 1
DEPLOY
