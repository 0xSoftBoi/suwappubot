#!/bin/sh
set -e

# SKIP_SCHEMA_SYNC=true bypasses the boot-time drizzle schema sync entirely.
# Use it when the schema is managed via reviewed migrations and the automatic
# `drizzle-kit push` would otherwise prompt (e.g. enum create-vs-rename) and
# hang a no-TTY container — failing the deploy healthcheck. Default behavior
# is unchanged when the flag is unset.
if [ "$SKIP_SCHEMA_SYNC" = "true" ]; then
  echo "SKIP_SCHEMA_SYNC=true — skipping drizzle schema sync (managed via migrations)"
else
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
fi

echo "Starting API server..."
exec bun run src/index.ts
