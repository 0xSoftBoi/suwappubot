#!/bin/bash
# Pull secrets from AWS Secrets Manager and write to .env
# Usage: sudo bash scripts/pull-secrets.sh
set -euo pipefail

APP_DIR="/home/ubuntu/suwappubot"
AWS_REGION="us-east-1"
ENV_FILE="$APP_DIR/.env"

echo "Pulling app secrets..."
APP_SECRETS=$(aws secretsmanager get-secret-value \
  --secret-id "suwappu/app-secrets" \
  --region "$AWS_REGION" \
  --query 'SecretString' --output text)

echo "Pulling DB credentials..."
DB_SECRETS=$(aws secretsmanager get-secret-value \
  --secret-id "suwappu/db-credentials" \
  --region "$AWS_REGION" \
  --query 'SecretString' --output text)

# Build DATABASE_URL from RDS secret
DB_HOST=$(echo "$DB_SECRETS" | jq -r '.host')
DB_PORT=$(echo "$DB_SECRETS" | jq -r '.port')
DB_USER=$(echo "$DB_SECRETS" | jq -r '.username')
DB_PASS=$(echo "$DB_SECRETS" | jq -r '.password')
DB_NAME=$(echo "$DB_SECRETS" | jq -r '.dbname // "suwappubot"')
DATABASE_URL="postgresql://${DB_USER}:${DB_PASS}@${DB_HOST}:${DB_PORT}/${DB_NAME}?sslmode=require"

# Write .env
cat > "$ENV_FILE" << ENVEOF
# Auto-generated from AWS Secrets Manager — do not edit manually
# Last updated: $(date -u +"%Y-%m-%dT%H:%M:%SZ")

DATABASE_URL=${DATABASE_URL}
ENVIRONMENT=production
PORT=10000
LOG_LEVEL=INFO
WALLET_PROVIDER=local
ENVEOF

# Append each key from app-secrets (skip DATABASE_URL to avoid duplicate)
echo "$APP_SECRETS" | jq -r 'to_entries[] | select(.key != "DATABASE_URL") | "\(.key)=\(.value)"' >> "$ENV_FILE"

# EC2-specific settings
echo "" >> "$ENV_FILE"
echo "# EC2 runtime settings" >> "$ENV_FILE"
echo "USE_WEBHOOK=false" >> "$ENV_FILE"
echo "PYTHONPATH=/home/ubuntu/suwappubot" >> "$ENV_FILE"

chmod 600 "$ENV_FILE"
chown ubuntu:ubuntu "$ENV_FILE"
echo "Secrets written to $ENV_FILE"
