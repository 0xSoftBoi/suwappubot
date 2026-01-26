# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Suwappu is a cross-chain DEX bot and liquidity infrastructure. It provides:
- Telegram bot for swapping tokens across 7+ chains (Ethereum, BSC, Polygon, Arbitrum, Optimism, Base, Solana)
- WhatsApp Business API integration
- Agent-to-Agent (A2A) API for AI agent interoperability
- Telegram Mini App dashboard

## Commands

```bash
# Run the monolith (API + Bot)
uvicorn api.main:app --host 0.0.0.0 --port 8000 --reload

# Run tests
pytest tests/
pytest tests/ --cov=bot --cov=api

# Docker (local development with polling)
docker-compose -f docker-compose.local.yml up

# Docker (production with webhook)
docker-compose up
```

### TUI (Terminal UI for AWS monitoring)
```bash
cd tui
bun install
bun run dev     # Development with hot reload
bun run start   # Production
```

### Webapp (Telegram Mini App)
```bash
cd webapp
npm install     # or bun install
npm run dev     # Vite dev server
npm run build   # Build for production
```

## Architecture

### Monolith Design
The application runs as a single FastAPI service (`api/main.py`) that:
1. Initializes database and config via lifespan manager
2. Builds and starts the Telegram bot application
3. Starts background services (fee sweeper, alerts, order service, tx poller, health monitor)
4. Exposes REST endpoints for agents, webhooks, and the Mini App

**Polling vs Webhook Mode**:
- `USE_WEBHOOK=false` (default): Bot polls Telegram. Single instance only.
- `USE_WEBHOOK=true`: Telegram pushes updates. Safe for multiple replicas.

### Key Modules

| Directory | Purpose |
|-----------|---------|
| `api/` | FastAPI endpoints, webhook handlers, auth |
| `bot/handlers/` | Telegram command handlers (start, swap, wallet, etc.) |
| `bot/services/` | Business logic - swap engines, wallet management, alerts |
| `bot/models/` | SQLAlchemy models |
| `bot/config/` | Settings (pydantic-settings), token configs, chain configs |
| `bot/utils/` | Encryption, rate limiting, formatters, caching |
| `database/` | DB init, schema migrations (no Alembic - additive migrations in db.py) |
| `tui/` | Bun + Ink TUI for AWS ECS monitoring |
| `webapp/` | React + Vite Telegram Mini App |

### Background Services

Started in `api/main.py` lifespan:
- `fee_sweeper` - Sweeps collected fees to treasury
- `alert_service` - Price alerts
- `order_service` - Limit orders and DCA execution
- `tx_poller` - Transaction status polling
- `health_monitor` - System health checks
- `launch_detector` - Token launch sniping (for `/snipe`)

### Data Flow

1. User sends command via Telegram/WhatsApp/Agent API
2. Handler processes command, calls appropriate service
3. Service interacts with external APIs (Li.Fi, Jupiter, RPCs)
4. Results stored in PostgreSQL, response sent to user

### External Integrations

- **Li.Fi API**: Cross-chain swaps for EVM chains
- **Jupiter API**: Solana swaps
- **Socket/Bungee API**: Super-aggregation (optional)
- **Turnkey**: TEE-backed wallet infrastructure (optional)
- **Alchemy**: Enhanced RPC and Token API (optional)

## Patterns & Conventions

### Database
- Uses SQLAlchemy 2.x with declarative base in `database/db.py`
- No Alembic - migrations are additive and idempotent in `_ensure_schema()`
- `get_session()` context manager for transaction handling
- `DATABASE_AVAILABLE` flag enables degraded mode without DB

### Adding Database Migrations

This project uses **runtime migrations** instead of Alembic. Migrations run automatically on app startup via `_ensure_schema()` in `database/db.py`. All migrations must be **additive** (no destructive changes) and **idempotent** (safe to run multiple times).

#### Step 1: Update the SQLAlchemy Model

Add or modify columns in the appropriate model file (e.g., `bot/models/user.py`):

```python
class User(Base):
    __tablename__ = "users"
    # ... existing columns ...
    new_column = Column(String(100), nullable=True, default=None)  # New column
```

#### Step 2: Add Migration Helper Function

In `database/db.py`, add a helper function following the existing pattern:

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

#### Step 3: Call from `_ensure_schema()`

Add your helper to the `_ensure_schema()` function:

```python
def _ensure_schema(db_engine) -> None:
    # ... existing migrations ...
    
    # --- new feature columns ---
    if "table_name" in tables:
        _add_new_feature_columns(db_engine, inspector, is_sqlite)
```

#### Step 4: Test Locally

```bash
# Start fresh SQLite database
rm -f suwappubot.db
uvicorn api.main:app --reload
# Check logs for "✓ Database schema migrations complete"
```

#### Migration Rules

| ✅ DO | ❌ DON'T |
|-------|----------|
| Add nullable columns with defaults | Drop columns or tables |
| Add indexes with `IF NOT EXISTS` | Rename columns (breaks existing code) |
| Use `ADD COLUMN IF NOT EXISTS` (Postgres) | Change column types destructively |
| Check column existence before ALTER | Assume migration order |
| Test on both SQLite and PostgreSQL | Add NOT NULL without defaults |

#### Index Migrations

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

#### Why No Alembic?

1. **Simpler deployment**: No separate migration step in CI/CD
2. **RDS in private VPC**: Can't run migrations from GitHub Actions
3. **Idempotent by design**: Safe to replay, no version tracking needed
4. **Zero-downtime deploys**: Old instances keep running while new ones start

### Wallet Encryption
- Default: `kms_aesgcm_v2` (envelope encryption with KMS)
- Legacy: `legacy_fernet_v1` (direct Fernet encryption)
- Auto-migration from v1 to v2 enabled by default

### Handlers Pattern
Telegram handlers in `bot/handlers/` follow:
- Command handlers decorated with `@CommandHandler`
- Callback query handlers for inline keyboard buttons
- Conversation handlers for multi-step flows (swap, withdrawal, etc.)

### Settings
All config via environment variables, loaded by `bot/config/settings.py` using pydantic-settings.
RPC URLs support comma-separated lists for load balancing.

## Telegram Bot Commands

| Command | Description |
|---------|-------------|
| `/start` | Main menu |
| `/s <amount> <token>` | Quick swap |
| `/w` | Wallet management |
| `/b` | Balance check |
| `/p` | Portfolio |
| `/a` | Price alerts |
| `/o` | Limit orders |
| `/snipe` | Token sniping |
| `/ref` | Referral program |
| `/xp` | Points/XP system |

Admin: `/st` (status), `/hw` (hot wallets), `/fee` (fees), `/m` (metrics)

## API Endpoints

| Endpoint | Auth | Description |
|----------|------|-------------|
| `GET /health` | None | Health check |
| `POST /telegram/webhook` | Secret token | Telegram updates |
| `POST /webhook` | Verify token | WhatsApp messages |
| `GET /tools` | X-Agent-Key | Agent tool discovery |
| `POST /v1/agent/execute` | X-Agent-Key | Natural language trading |
| `GET /users/{id}/portfolio` | X-Agent-Key | User balances |
| `POST /auth/turnkey/*` | None | Wallet-based auth |

## Testing

```bash
# Run all tests
pytest tests/

# Run with coverage
pytest tests/ --cov=bot --cov=api

# Run single test file
pytest tests/test_wallet.py -v

# Run single test
pytest tests/test_wallet.py::test_create_wallet -v
```
