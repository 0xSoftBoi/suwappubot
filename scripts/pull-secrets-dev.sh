#!/bin/bash
# Pull dev secrets from AWS Secrets Manager and write to .env
# Usage: sudo bash scripts/pull-secrets-dev.sh
set -euo pipefail

APP_DIR="/home/ubuntu/suwappubot"
AWS_REGION="us-east-1"
ENV_FILE="$APP_DIR/.env"

echo "Pulling dev secrets..."
DEV_SECRETS=$(aws secretsmanager get-secret-value \
  --secret-id "suwappu/dev-secrets" \
  --region "$AWS_REGION" \
  --query 'SecretString' --output text)

# Write .env from dev-secrets
cat > "$ENV_FILE" << ENVEOF
# Auto-generated from suwappu/dev-secrets — do not edit manually
# Last updated: $(date -u +"%Y-%m-%dT%H:%M:%SZ")
ENVIRONMENT=development
PORT=10000
LOG_LEVEL=DEBUG
WALLET_PROVIDER=local
USE_WEBHOOK=false
PYTHONPATH=/home/ubuntu/suwappubot
ENVEOF

# Append each key from dev-secrets
echo "$DEV_SECRETS" | jq -r 'to_entries[] | "\(.key)=\(.value)"' >> "$ENV_FILE"

chmod 600 "$ENV_FILE"
chown ubuntu:ubuntu "$ENV_FILE"
echo "Dev secrets written to $ENV_FILE"
