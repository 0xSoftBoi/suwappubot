# Database Migrations

This project uses **runtime migrations** instead of Alembic. Migrations run automatically on app startup via `_ensure_schema()` in `database/db.py`. All migrations must be **additive** (no destructive changes) and **idempotent** (safe to run multiple times).

## How It Works

1. `init_db()` creates tables from SQLAlchemy models via `Base.metadata.create_all()`
2. `_ensure_schema()` runs additive column/index migrations for existing deployments
3. Each helper function checks if the column exists before adding it
4. Both SQLite (local dev) and PostgreSQL (production) are supported

## Adding a New Migration

### Step 1: Update the SQLAlchemy Model

Add or modify columns in the model file (e.g., `bot/models/user.py`):

```python
class User(Base):
    __tablename__ = "users"
    # ... existing columns ...
    new_column = Column(String(100), nullable=True, default=None)
```

### Step 2: Add Migration Helper Function

In `database/db.py`, add a helper following the existing pattern:

```python
def _add_new_feature_columns(db_engine, inspector, is_sqlite: bool) -> None:
    """Add columns for <feature> idempotently."""
    cols = {c["name"] for c in inspector.get_columns("table_name")}

    new_columns = [
        ("new_column", "VARCHAR(100)", "NULL"),
        ("another_column", "BOOLEAN", "0"),
    ]

    for col_name, col_type, default in new_columns:
        if col_name not in cols:
            if is_sqlite:
                ddl = f"ALTER TABLE table_name ADD COLUMN {col_name} {col_type} DEFAULT {default}"
            else:
                ddl = f"ALTER TABLE table_name ADD COLUMN IF NOT EXISTS {col_name} {col_type} DEFAULT {default}"
            with db_engine.begin() as conn:
                conn.execute(text(ddl))
```

### Step 3: Call from `_ensure_schema()`

```python
def _ensure_schema(db_engine) -> None:
    # ... existing migrations ...

    # --- new feature columns ---
    if "table_name" in tables:
        _add_new_feature_columns(db_engine, inspector, is_sqlite)
```

### Step 4: Test Locally

```bash
rm -f suwappubot.db
uvicorn api.main:app --reload
# Check logs for "✓ Database schema migrations complete"
```

## Migration Rules

| ✅ DO | ❌ DON'T |
|-------|----------|
| Add nullable columns with defaults | Drop columns or tables |
| Add indexes with `IF NOT EXISTS` | Rename columns (breaks existing code) |
| Use `ADD COLUMN IF NOT EXISTS` (Postgres) | Change column types destructively |
| Check column existence before ALTER | Assume migration order |
| Test on both SQLite and PostgreSQL | Add NOT NULL without defaults |

## Index Migrations

```python
# Add index idempotently
with db_engine.begin() as conn:
    conn.execute(text(
        "CREATE INDEX IF NOT EXISTS ix_table_column ON table_name(column_name)"
    ))

# Add unique index
with db_engine.begin() as conn:
    conn.execute(text(
        "CREATE UNIQUE INDEX IF NOT EXISTS ux_table_column ON table_name(column_name)"
    ))
```

## Why No Alembic?

1. **Simpler deployment**: No separate migration step in CI/CD
2. **RDS in private VPC**: Can't run migrations from GitHub Actions
3. **Idempotent by design**: Safe to replay, no version tracking needed
4. **Zero-downtime deploys**: Old instances keep running while new ones start

## Reference

- Migration code: `database/db.py` → `_ensure_schema()`
- Models: `bot/models/`
- Skill: Use `/migrations` in Claude Code for a guided walkthrough
