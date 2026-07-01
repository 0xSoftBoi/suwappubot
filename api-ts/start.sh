#!/bin/sh
set -e

# SKIP_SCHEMA_SYNC=true bypasses the boot-time drizzle schema sync entirely
# (skips `migrate` too, not just `push`). Escape valve for emergency deploys when
# the schema is known-good and you want to skip the DB round-trip. Default runs migrate.
if [ "$SKIP_SCHEMA_SYNC" = "true" ]; then
  echo "SKIP_SCHEMA_SYNC=true — skipping drizzle schema sync (managed via migrations)"
else
  echo "Running database schema sync..."
  if [ "$NODE_ENV" = "production" ]; then
    # Prod: migrate ONLY. Migration files are committed under drizzle/ and are the
    # reviewed source of truth. `migrate` runs unapplied migration SQL verbatim and
    # NEVER introspects/drops the live DB — safe under dual ownership with the Python
    # stack's _ensure_schema(). No `push` fallback: `push --force` reconciles the DB to
    # match ONLY the Drizzle schema and can DROP columns/tables it doesn't know about,
    # plus it prompts + hangs in a no-TTY container. A migrate failure should fail the
    # deploy (Railway holds the previous revision), not silently push.
    bun run drizzle-kit migrate
  else
    # Dev: disposable DB, direct schema sync (tablesFilter scopes it to Drizzle-owned tables).
    bun run drizzle-kit push --force || echo "WARNING: Schema push failed, continuing startup..."
  fi
fi

echo "Starting API server..."
exec bun run src/index.ts
