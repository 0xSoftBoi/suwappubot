#!/usr/bin/env bash
# Database backup script for Suwappu.
# Runs as a Fargate task before deployments.
#
# Required environment variables:
#   DATABASE_URL  - PostgreSQL connection string
#   S3_BUCKET     - Target S3 bucket name
#   BACKUP_PREFIX - S3 key prefix (e.g. "pre-deploy")

set -euo pipefail

TIMESTAMP=$(date -u +"%Y%m%dT%H%M%SZ")
FILENAME="${BACKUP_PREFIX:-manual}/${TIMESTAMP}.sql.gz"

echo "Starting database backup..."
echo "  Timestamp: ${TIMESTAMP}"
echo "  Target: s3://${S3_BUCKET}/${FILENAME}"

pg_dump "${DATABASE_URL}" \
  --no-owner \
  --no-privileges \
  --format=plain \
  | gzip \
  | aws s3 cp - "s3://${S3_BUCKET}/${FILENAME}"

echo "Backup uploaded successfully: s3://${S3_BUCKET}/${FILENAME}"
