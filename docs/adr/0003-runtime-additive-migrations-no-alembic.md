# 0003 — Runtime additive migrations, no Alembic

**Status**: Accepted (backfilled 2026-08; decision predates this record)

## Context

One PostgreSQL database is shared by two stacks: Python/SQLAlchemy
(`bot/models/`) and TypeScript/Drizzle (`api-ts/src/db/schema/`). A
migration-tool-per-stack (Alembic + Drizzle Kit) would create two competing
migration histories over the same tables, and operating Alembic adds a deploy
step for a small team.

## Decision

Python-side schema changes are applied at boot by `_ensure_schema()` in
`database/db.py`. Every migration must be **additive and idempotent**
(CREATE TABLE IF NOT EXISTS, ADD COLUMN guarded by existence checks). No
Alembic. The Drizzle schema mirrors the same tables for the TS stack; both
sides change together in one PR. See `docs/development/migrations.md`,
`/migrations` skill, `db-migrate` agent.

## Consequences

- Deploys need no migration step; a fresh DB self-initializes.
- A non-idempotent or destructive change breaks **every subsequent boot**, not
  one deploy — migrations are effectively money-path for availability.
- Dropping/renaming columns requires a deliberate multi-phase dance (add new,
  backfill, cut over, drop later) — rename-in-place is not supported.
- CI enforces cross-stack consistency via the Postgres contract job
  (Python migration ↔ Drizzle idempotency).
