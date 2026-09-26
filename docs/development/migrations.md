# Database Migrations

One PostgreSQL database, two ORMs, no Alembic (ADR 0003). Every schema change
touches **both stacks in one PR** or it isn't done.

## The rules (hard, non-negotiable)

1. **Additive only.** New tables, new columns, new indexes. No DROP, no
   RENAME, no type-narrowing at startup — ever.
2. **Idempotent always.** The migration runs on *every* boot. `CREATE TABLE
   IF NOT EXISTS`, column-adds guarded by existence checks. A non-idempotent
   statement breaks every subsequent boot, not one deploy.
3. **Both ORMs.** Python `bot/models/` + `database/db.py:_ensure_schema()`
   AND the Drizzle schema in `api-ts/src/db/schema/`. CI's Postgres contract
   job (`api-ts-shared-db-migration` in `.github/workflows/test.yml`) checks
   the pair stays idempotent-compatible.

## Step-by-step

1. Add/modify the SQLAlchemy model in `bot/models/`.
2. Add the guarded DDL to `_ensure_schema()` in `database/db.py` — copy the
   pattern of an existing column-add.
3. Mirror the change in the matching file under `api-ts/src/db/schema/`.
4. If the type is exposed to clients, update `packages/sdk/src/types.ts`.
5. Test locally: boot twice (`uvicorn api.main:app` restart) — the second
   boot proves idempotency. Then `pytest tests/` and `bun run check`.

## Renames & drops (multi-phase, deliberate)

Rename-in-place is not supported. Instead: **add** the new column → dual-write
→ backfill → cut reads over → stop writing old → drop later in a manual,
operator-run migration (never at startup).

## Why no Alembic

Two migration tools over one DB would fight; the bot deploys as a single
writer, and additive+idempotent changes cannot corrupt existing data. Full
rationale: [ADR 0003](../adr/0003-runtime-additive-migrations-no-alembic.md).
