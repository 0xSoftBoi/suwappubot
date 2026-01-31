#!/bin/sh
set -e

echo "Running database migrations..."
bun run drizzle-kit migrate

echo "Starting API server..."
exec bun run src/index.ts
