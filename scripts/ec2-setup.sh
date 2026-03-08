#!/bin/bash
# EC2 instance setup for Suwappu Bot
# Run once on a fresh Ubuntu 22.04/24.04 EC2 instance:
#   sudo bash scripts/ec2-setup.sh [branch]
set -euo pipefail

APP_USER="ubuntu"
APP_DIR="/home/$APP_USER/suwappubot"
REPO_URL="https://github.com/0xSoftBoi/suwappubot.git"
BRANCH="${1:-main}"
AWS_REGION="us-east-1"

echo "=== Installing system dependencies ==="
apt-get update
apt-get install -y python3.11 python3.11-venv python3.11-dev \
  gcc g++ libpq-dev libssl-dev git curl jq

echo "=== Cloning repo ==="
if [ ! -d "$APP_DIR" ]; then
  sudo -u "$APP_USER" git clone "$REPO_URL" "$APP_DIR"
else
  sudo -u "$APP_USER" git -C "$APP_DIR" fetch origin
  sudo -u "$APP_USER" git -C "$APP_DIR" checkout "$BRANCH"
  sudo -u "$APP_USER" git -C "$APP_DIR" pull
fi

echo "=== Creating venv ==="
sudo -u "$APP_USER" python3.11 -m venv "$APP_DIR/venv"
sudo -u "$APP_USER" "$APP_DIR/venv/bin/pip" install --upgrade pip
sudo -u "$APP_USER" "$APP_DIR/venv/bin/pip" install -r "$APP_DIR/requirements.txt"
sudo -u "$APP_USER" "$APP_DIR/venv/bin/pip" install psycopg2-binary gunicorn
sudo -u "$APP_USER" "$APP_DIR/venv/bin/pip" install "$APP_DIR"

echo "=== Pulling secrets from AWS Secrets Manager ==="
bash "$APP_DIR/scripts/pull-secrets.sh"

echo "=== Installing systemd service ==="
cp "$APP_DIR/suwappubot.service" /etc/systemd/system/suwappubot.service
systemctl daemon-reload
systemctl enable suwappubot
systemctl start suwappubot

echo "=== Setup complete ==="
echo "Check status: systemctl status suwappubot"
echo "View logs:    journalctl -u suwappubot -f"
