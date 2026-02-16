---
description: "Database migration tutorial — add columns, tables, indexes"
---

# Database Migration Guide

This project uses **runtime migrations** (no Alembic). Migrations run automatically on startup via `_ensure_schema()` in `database/db.py`.

## Step-by-Step: Add a New Column

### 1. Update the SQLAlchemy Model

Edit the model file in `bot/models/`:

```python
class User(Base):
    __tablename__ = "users"
    # ... existing columns ...
    new_column = Column(String(100), nullable=True, default=None)
```

### 2. Add Migration Helper in `database/db.py`

Follow the existing pattern — every helper is a standalone function:

```python
def _add_new_feature_columns(db_engine, inspector, is_sqlite: bool) -> None:
    """Add columns for <feature> idempotently."""
    cols = {c["name"] for c in inspector.get_columns("table_name")}

    new_columns = [
        # (column_name, sql_type, default_value)
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

### 3. Register in `_ensure_schema()`

Add your helper call at the end of `_ensure_schema()`:

```python
def _ensure_schema(db_engine) -> None:
    # ... existing migrations ...

    if "table_name" in tables:
        _add_new_feature_columns(db_engine, inspector, is_sqlite)
```

### 4. Test Locally

```bash
rm -f suwappubot.db
uvicorn api.main:app --reload
# Look for "✓ Database schema migrations complete" in logs
```

## Adding Indexes

```python
with db_engine.begin() as conn:
    conn.execute(text(
        "CREATE INDEX IF NOT EXISTS ix_table_column ON table_name(column_name)"
    ))

# Unique index
with db_engine.begin() as conn:
    conn.execute(text(
        "CREATE UNIQUE INDEX IF NOT EXISTS ux_table_column ON table_name(column_name)"
    ))
```

## SQLite vs PostgreSQL Differences

| Feature | SQLite | PostgreSQL |
|---------|--------|------------|
| Add column | `ALTER TABLE ... ADD COLUMN col TYPE` | `ALTER TABLE ... ADD COLUMN IF NOT EXISTS col TYPE` |
| Check existence | Must query `inspector.get_columns()` | `IF NOT EXISTS` handles it |
| Index creation | `CREATE INDEX IF NOT EXISTS` | Same |
| Column type changes | Not supported (recreate table) | `ALTER COLUMN ... TYPE` |

Always check column existence with `inspector.get_columns()` for SQLite compatibility.

## Migration Rules

| ✅ DO | ❌ DON'T |
|-------|----------|
| Add nullable columns with defaults | Drop columns or tables |
| Add indexes with `IF NOT EXISTS` | Rename columns (breaks existing code) |
| Use `ADD COLUMN IF NOT EXISTS` (Postgres) | Change column types destructively |
| Check column existence before ALTER | Assume migration order |
| Test on both SQLite and PostgreSQL | Add NOT NULL without defaults |

## Why No Alembic?

1. **Simpler deployment** — no separate migration step in CI/CD
2. **RDS in private VPC** — can't run migrations from GitHub Actions
3. **Idempotent by design** — safe to replay, no version tracking needed
4. **Zero-downtime deploys** — old instances keep running while new ones start

## Reference Files

- `database/db.py` — `_ensure_schema()` and all migration helpers
- `bot/models/` — SQLAlchemy model definitions
- `docs/development/migrations.md` — written documentation
