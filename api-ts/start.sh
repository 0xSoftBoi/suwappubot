#!/bin/sh
set -e

echo "Running database schema sync..."
# Use push for dev (direct schema sync), migrate for prod (migration files)
if [ "$NODE_ENV" = "production" ]; then
  bun run drizzle-kit migrate || echo "WARNING: Migration failed, continuing startup..."
else
  bun run drizzle-kit push --force || echo "WARNING: Schema push failed, continuing startup..."
fi

echo "Starting API server..."
exec bun run src/index.ts
