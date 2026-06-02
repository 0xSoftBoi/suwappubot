#!/bin/sh
set -e

echo "Running database schema sync..."
# Use push for dev (direct schema sync), migrate for prod (migration files).
# Prod falls back to push when there are no committed migration files (fresh DB has no
# drizzle/meta/_journal.json), so the schema still gets created.
if [ "$NODE_ENV" = "production" ]; then
  bun run drizzle-kit migrate \
    || bun run drizzle-kit push --force \
    || echo "WARNING: schema sync failed, continuing startup..."
else
  bun run drizzle-kit push --force || echo "WARNING: Schema push failed, continuing startup..."
fi

echo "Starting API server..."
exec bun run src/index.ts
