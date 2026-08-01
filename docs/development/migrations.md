# Database migrations

Suwappu runs **two ORMs against one PostgreSQL database**:

| Stack | ORM | Schema lives in |
|-------|-----|-----------------|
| Python monolith (`bot/`, `api/`) | SQLAlchemy | `bot/models/` |
| TypeScript API (`api-ts/`) | Drizzle | `api-ts/src/db/schema/` |

Getting a schema change right means understanding which of the two **owns** the table.

## There is no Alembic

The Python side has no migration files and no version table. Instead,
`database/db.py` runs three steps at startup:

```python
_reconcile_cross_orm_tables(engine)   # drop empty wrong-shaped cross-ORM tables
Base.metadata.create_all(bind=engine) # create any missing tables
_ensure_schema(engine)                # additive column/index migrations
```

`_ensure_schema()` is the migration system. It is a single function that inspects the live
schema and applies whatever is missing.

**Every migration must be additive and idempotent.** It runs on every boot, on every
replica. It must be safe to run against a fresh database and against one that is already
fully migrated.

That means:

- ✅ `ADD COLUMN`, `CREATE INDEX IF NOT EXISTS`, backfilling a new column with a default
- ❌ `DROP COLUMN`, `DROP TABLE`, renaming a column in use, anything destructive or
  order-dependent

There is no down-migration. If you need to remove a column, ship a release that stops
reading it, then remove it manually once every replica is on the new code.

## Adding a column (Python side)

Two edits, in this order.

**1. Add it to the SQLAlchemy model** in `bot/models/`, so fresh databases get it from
`create_all`:

```python
class User(Base):
    __tablename__ = "users"
    ...
    region = Column(String(8), nullable=True)
```

**2. Add it to `_ensure_schema()`** in `database/db.py`, so *existing* databases get it
too. Follow the established guard-and-branch pattern:

```python
if "users" in tables:
    cols = {c["name"] for c in inspector.get_columns("users")}
    if "region" not in cols:
        if is_sqlite:
            ddl = "ALTER TABLE users ADD COLUMN region VARCHAR(8)"
        else:
            ddl = "ALTER TABLE users ADD COLUMN IF NOT EXISTS region VARCHAR(8)"
        with db_engine.begin() as conn:
            conn.execute(text(ddl))
```

The SQLite branch is not optional. Tests run against SQLite, which does not support
`ADD COLUMN IF NOT EXISTS` — hence the explicit `cols` membership check *and* the dialect
branch. Skipping either one breaks the test suite or breaks production.

Indexes are simpler, because `IF NOT EXISTS` is portable:

```python
with db_engine.begin() as conn:
    conn.execute(text(
        "CREATE UNIQUE INDEX IF NOT EXISTS ux_swap_transactions_idempotency_key "
        "ON swap_transactions(idempotency_key)"
    ))
```

## Adding a table or column (TypeScript side)

```bash
cd api-ts
bun run db:generate   # generate migration files from the schema
bun run db:push       # apply to the database
bun run db:studio     # inspect the result
```

### The ownership rule

`api-ts/drizzle.config.ts` sets a `tablesFilter` that scopes drizzle-kit to **only the
tables api-ts exclusively owns**. This is deliberate: the database is shared, and
SQLAlchemy is the authority for every table both services define (`users`, `wallets`,
`limit_orders`, `agents`, …). Without the filter, `drizzle-kit push` would happily alter or
drop Python-owned columns.

So:

- **Table exists in `bot/models/`?** SQLAlchemy owns it. Drizzle may *read* it — declare the
  `pgTable` for queries, but do **not** add it to `tablesFilter`, and migrate it through
  `_ensure_schema()`.
- **New table only api-ts uses?** api-ts owns it. Declare it *and* **add it to
  `tablesFilter`**.

Forgetting to add an api-ts-exclusive table to `tablesFilter` makes `drizzle-kit push`
re-emit `CREATE TABLE` for it on every boot, producing `relation … already exists`. The
startup script swallows that error, so it does not crash — it just fills your logs with
noise that hides real failures.

## Changing a table both stacks use

Do all three, or the two stacks will disagree at runtime:

1. Update the SQLAlchemy model in `bot/models/`
2. Add the additive migration to `_ensure_schema()` in `database/db.py`
3. Update the matching Drizzle `pgTable` in `api-ts/src/db/schema/` so its types match
   reality — but do **not** add the table to `tablesFilter`

## Testing a migration

```bash
pytest tests/                          # runs against SQLite — catches missing dialect branches
rm -f suwappu.db && pytest tests/      # verify a fresh database bootstraps cleanly
```

Then verify idempotency, which is the failure mode that reaches production: start the
service twice against the same database. The second boot must log
`✓ Database schema migrations complete` without errors.
