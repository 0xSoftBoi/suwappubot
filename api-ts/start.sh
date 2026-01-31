#!/bin/sh
set -e

echo "Running database migrations..."
bun run drizzle-kit migrate || echo "Migration failed or already up to date"

echo "Starting API server..."
exec bun run src/index.ts
