#!/usr/bin/env bash
#
# Portable, provider-agnostic Postgres backup: pg_dump -> S3-compatible object storage
# (Cloudflare R2 / Backblaze B2 / MinIO / AWS S3). Open source, no vendor lock-in — a dump
# you hold yourself, restorable into ANY Postgres anywhere with `pg_restore`.
#
# Run it as a Railway CRON service (recommended) or anywhere with network access to the DB:
#   - Railway: new service from the official `postgres:16` image (must match your DB major
#     version), set the service's cron schedule (e.g. "0 4 * * *" = 04:00 UTC daily), and
#     set the env vars below. Set the Start Command to: bash scripts/backup-to-r2.sh
#   - Locally / CI: export the env vars and run `bash scripts/backup-to-r2.sh`.
#
# Required env:
#   DATABASE_URL        Source DB (use the Railway Postgres reference ${{Postgres.DATABASE_URL}})
#   S3_BUCKET           Target bucket name
#   S3_ENDPOINT         S3-compatible endpoint (e.g. https://<acct>.r2.cloudflarestorage.com)
#   AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY   Object-storage credentials
# Optional env:
#   S3_PREFIX           Key prefix (default: suwappu)
#   RETENTION_DAYS      Delete dumps older than N days (default: 30; 0 = keep forever)
#   AWS_DEFAULT_REGION  Region label (R2 ignores it; default: auto)
#
# Restore (the whole point — test this periodically):
#   aws s3 cp s3://$S3_BUCKET/<key>.dump ./restore.dump --endpoint-url "$S3_ENDPOINT"
#   pg_restore --no-owner --no-acl -d "<target DATABASE_URL>" ./restore.dump
set -euo pipefail

: "${DATABASE_URL:?set DATABASE_URL}"
: "${S3_BUCKET:?set S3_BUCKET}"
: "${S3_ENDPOINT:?set S3_ENDPOINT}"
: "${AWS_ACCESS_KEY_ID:?set AWS_ACCESS_KEY_ID}"
: "${AWS_SECRET_ACCESS_KEY:?set AWS_SECRET_ACCESS_KEY}"
S3_PREFIX="${S3_PREFIX:-suwappu}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
export AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-auto}"

command -v pg_dump >/dev/null || { echo "pg_dump not found (use the postgres image)"; exit 1; }
command -v aws >/dev/null || { echo "aws CLI not found (pip install awscli or apt-get install awscli)"; exit 1; }

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="/tmp/${S3_PREFIX}-${STAMP}.dump"
KEY="${S3_PREFIX}/${S3_PREFIX}-${STAMP}.dump"

echo "[backup] pg_dump -> ${FILE}"
pg_dump "$DATABASE_URL" -F c -f "$FILE"          # custom format: compressed + pg_restore-ready

echo "[backup] upload -> s3://${S3_BUCKET}/${KEY}"
aws s3 cp "$FILE" "s3://${S3_BUCKET}/${KEY}" --endpoint-url "$S3_ENDPOINT"
rm -f "$FILE"

if [ "${RETENTION_DAYS}" -gt 0 ]; then
  CUTOFF=$(date -u -d "${RETENTION_DAYS} days ago" +%Y%m%dT%H%M%SZ 2>/dev/null \
           || date -u -v-"${RETENTION_DAYS}"d +%Y%m%dT%H%M%SZ)   # GNU or BSD date
  echo "[backup] pruning dumps older than ${CUTOFF}"
  aws s3 ls "s3://${S3_BUCKET}/${S3_PREFIX}/" --endpoint-url "$S3_ENDPOINT" | awk '{print $4}' \
  | while read -r obj; do
      [ -z "$obj" ] && continue
      ts=$(echo "$obj" | grep -oE '[0-9]{8}T[0-9]{6}Z' || true)
      [ -n "$ts" ] && [ "$ts" \< "$CUTOFF" ] && \
        aws s3 rm "s3://${S3_BUCKET}/${S3_PREFIX}/${obj}" --endpoint-url "$S3_ENDPOINT"
    done
fi

echo "[backup] done: ${KEY}"
