#!/bin/sh
set -e

echo "Running database schema sync..."
# Use push for dev (direct schema sync), migrate for prod (migration files)
if [ "$NODE_ENV" = "production" ]; then
  bun run drizzle-kit migrate
else
  bun run drizzle-kit push --force
fi

echo "Starting API server..."
exec bun run src/index.ts
