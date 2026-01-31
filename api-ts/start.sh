#!/bin/sh
set -e

echo "Running database schema sync..."
# Use push for dev (direct schema sync), migrate for prod (migration files)
if [ "$NODE_ENV" = "production" ]; then
  bun run drizzle-kit migrate || echo "Migration failed or already up to date"
else
  bun run drizzle-kit push --force || echo "Schema push failed"
fi

echo "Starting API server..."
exec bun run src/index.ts
