# Database Migrations

This directory contains Alembic database migrations for Suwappubot.

## Setup

Migrations are configured to read `DATABASE_URL` from environment variables.

```bash
# Set your database URL
export DATABASE_URL="postgresql://user:pass@host:5432/dbname"
```

## Common Commands

### Check current revision
```bash
alembic current
```

### View migration history
```bash
alembic history
```

### Create a new migration (auto-generate from model changes)
```bash
alembic revision --autogenerate -m "description of changes"
```

### Create an empty migration (manual)
```bash
alembic revision -m "description of changes"
```

### Apply all pending migrations
```bash
alembic upgrade head
```

### Apply next migration only
```bash
alembic upgrade +1
```

### Rollback last migration
```bash
alembic downgrade -1
```

### Rollback all migrations
```bash
alembic downgrade base
```

### Generate SQL without applying (offline mode)
```bash
alembic upgrade head --sql
```

## Migration Guidelines

### DO:
- Always review auto-generated migrations before committing
- Include both `upgrade()` and `downgrade()` functions
- Test migrations on a local database first
- Use descriptive migration messages
- Keep migrations small and focused

### DON'T:
- Commit migrations that drop data without confirmation
- Skip the review step for auto-generated migrations
- Run `alembic downgrade` on production without a backup
- Modify migrations that have already been applied to production

## Troubleshooting

### "Target database is not up to date"
```bash
# Check current state
alembic current

# Apply pending migrations
alembic upgrade head
```

### "Can't locate revision"
```bash
# Stamp the database with current revision
alembic stamp head
```

### Migration conflicts
If two developers create migrations from the same base:
1. Merge their branches
2. One migration needs `down_revision` updated
3. Or create a merge migration: `alembic merge heads -m "merge branches"`

## Environment-Specific Notes

### Development (SQLite)
```bash
export DATABASE_URL="sqlite:///./suwappubot.db"
alembic upgrade head
```

### Production (PostgreSQL on AWS RDS)
```bash
# DATABASE_URL is set via AWS Secrets Manager in CI/CD
alembic upgrade head
```

### CI/CD
Migrations run automatically before ECS deployment via GitHub Actions.
See `.github/workflows/deploy-ecs.yml` for details.
