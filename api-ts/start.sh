#!/bin/bash
set -e

# Add sslmode to DATABASE_URL if not present
if [[ "$DATABASE_URL" != *"sslmode="* ]]; then
    if [[ "$DATABASE_URL" == *"?"* ]]; then
        export DATABASE_URL="${DATABASE_URL}&sslmode=require"
    else
        export DATABASE_URL="${DATABASE_URL}?sslmode=require"
    fi
fi

echo "🚀 Starting server..."
exec bun run src/index.ts
