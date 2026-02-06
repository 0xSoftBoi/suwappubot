# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Git Conventions

- Do NOT add "Co-Authored-By" lines to commit messages.

## Project Overview

Suwappu is a cross-chain DEX bot and liquidity infrastructure. It provides:
- Telegram bot for swapping tokens across 7+ chains (Ethereum, BSC, Polygon, Arbitrum, Optimism, Base, Solana)
- WhatsApp Business API integration
- Agent-to-Agent (A2A) API for AI agent interoperability
- Telegram Mini App dashboard

For detailed technical guides, see the reorganized documentation in `docs/`:
- **Architecture**: [docs/architecture/scaling_guide.md](docs/architecture/scaling_guide.md)
- **Deployment**: [docs/deployment/aws_deployment.md](docs/deployment/aws_deployment.md)
- **Development**: [docs/development/local_setup.md](docs/development/local_setup.md)
- **Agent Guide**: [docs/features/agent_integration.md](docs/features/agent_integration.md)
- **Operations**: [docs/operations/health_check.md](docs/operations/health_check.md)

## Commands

### Python Bot + API
```bash
# Run the monolith (API + Bot)
uvicorn api.main:app --host 0.0.0.0 --port 8000 --reload

# Run tests
pytest tests/
pytest tests/ --cov=bot --cov=api

# Run single test file
pytest tests/test_wallet.py -v

# Run single test
pytest tests/test_wallet.py::test_create_wallet -v

# Docker (local development with polling)
docker-compose -f docker-compose.local.yml up

# Docker (production with webhook)
docker-compose up
```

### TypeScript API (api-ts)
```bash
cd api-ts
bun install
bun run dev      # Hot reload development server
bun run build    # Build for production
bun run check    # TypeScript type checking

# Drizzle ORM database commands
bun run db:generate  # Generate migration files
bun run db:push      # Push schema changes to database
bun run db:migrate   # Run migrations
bun run db:studio    # Open Drizzle Studio GUI
```

### Webapp (Telegram Mini App)
```bash
cd webapp
npm install     # or bun install
npm run dev     # Vite dev server
npm run build   # Build for production
npm run test    # Run unit tests (hooks, lib)
npm run test:integration  # Run integration tests
npm run test:all          # Run all tests
```

### TUI (Terminal UI for AWS monitoring)
```bash
cd tui
bun install
bun run dev     # Development with hot reload
bun run start   # Production
```

### Mobile (Expo iOS)
```bash
cd mobile
bun install
bun run ios     # Start iOS simulator
```

### Showcase (Homepage)
```bash
cd showcase
bun install
bun run dev     # Development server
```

## Architecture

### Service Architecture
Suwappu consists of multiple services:

1. **Python Monolith** (`api/` + `bot/`): FastAPI service that runs bot + legacy API
2. **TypeScript API** (`api-ts/`): Modern Hono + Effect-TS API for agents and webapp
3. **Webapp** (`webapp/`): React + Vite Telegram Mini App
4. **Showcase** (`showcase/`): Next.js homepage
5. **Mobile** (`mobile/`): Expo iOS app

**Polling vs Webhook Mode** (Python Bot):
- `USE_WEBHOOK=false` (default): Bot polls Telegram. Single instance only.
- `USE_WEBHOOK=true`: Telegram pushes updates. Safe for multiple replicas.

### Key Modules

| Directory | Purpose |
|-----------|---------|
| `api/` | Python FastAPI endpoints, webhook handlers |
| `api-ts/` | TypeScript API with Hono + Effect-TS + Drizzle ORM |
| `bot/handlers/` | Telegram command handlers (start, swap, wallet, etc.) |
| `bot/services/` | Business logic - swap engines, wallet management, alerts |
| `bot/models/` | SQLAlchemy models (Python) |
| `bot/config/` | Settings (pydantic-settings), token configs, chain configs |
| `bot/utils/` | Encryption, rate limiting, formatters, caching |
| `database/` | DB init, schema migrations (no Alembic - additive migrations in db.py) |
| `packages/shared/` | Shared TypeScript types across api-ts, webapp, mobile |
| `webapp/` | React + Vite Telegram Mini App |
| `mobile/` | Expo iOS app |
| `showcase/` | Next.js homepage |
| `tui/` | Bun + Ink TUI for AWS ECS monitoring |
| `infra/` | AWS CDK infrastructure definitions |
| `docs/` | Centralized documentation |

### Background Services (Python Monolith)

Started in `api/main.py` lifespan:
- `fee_sweeper` - Sweeps collected fees to treasury
- `alert_service` - Price alerts
- `order_service` - Limit orders and DCA execution
- `tx_poller` - Transaction status polling
- `health_monitor` - System health checks
- `launch_detector` - Token launch sniping (for `/snipe`)

### TypeScript API Architecture

The TypeScript API (`api-ts/`) uses Effect-TS for dependency injection and composable effects:

```typescript
// Services are Context Tags
class UserService extends Context.Tag('UserService')<UserService, UserServiceInterface>() {}

// Layers provide implementations
const UserServiceLive = Layer.succeed(UserService, { ... })

// Effects compose services
const getUser = Effect.gen(function* () {
  const userService = yield* UserService
  return yield* userService.getUserById(id)
})

// ManagedRuntime executes effects
const result = await runEffect(getUser)
```

**Key Concepts**:
- **Effect**: Lazy computation with typed errors and dependencies
- **Layer**: Dependency injection container
- **ManagedRuntime**: Long-lived runtime for executing effects
- **Schema**: Type-safe validation with `@effect/schema`
- **Drizzle ORM**: Type-safe SQL queries

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
All config via environment variables:
- Python: loaded by `bot/config/settings.py` using pydantic-settings
- TypeScript: loaded by `api-ts/src/config/EnvService.ts` as Effect Layer
- RPC URLs support comma-separated lists for load balancing

### Shared Types
The `packages/shared/` directory contains TypeScript types shared across:
- `api-ts/` - TypeScript API
- `webapp/` - Telegram Mini App
- `mobile/` - iOS app

This ensures type safety across the full stack without duplication.

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

### Python API (Legacy)
| Endpoint | Auth | Description |
|----------|------|-------------|
| `GET /health` | None | Health check |
| `POST /telegram/webhook` | Secret token | Telegram updates |
| `POST /webhook` | Verify token | WhatsApp messages |

### TypeScript API (Primary)
| Endpoint | Auth | Description |
|----------|------|-------------|
| `GET /health` | None | Health check |
| `GET /tools` | X-Agent-Key | Agent tool discovery (A2A protocol) |
| `POST /v1/agent/execute` | X-Agent-Key | Natural language trading |
| `GET /users/{id}/wallets` | X-Agent-Key | List user wallets |
| `GET /users/{id}/portfolio` | X-Agent-Key | User portfolio with balances |
| `GET /users/{id}/swaps` | X-Agent-Key | User swap history |
| `POST /webapp/validate` | X-Telegram-Init-Data | Validate Telegram auth |
| `GET /webapp/users/me/portfolio` | X-Telegram-Init-Data | Current user portfolio |
| `GET /webapp/users/me/swaps` | X-Telegram-Init-Data | Current user swap history |

## Testing

### Python Tests
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

### Webapp Tests
```bash
cd webapp

# Run unit tests (hooks, lib)
bun run test

# Run integration tests
bun run test:integration

# Run all tests
bun run test:all

# Run with coverage
bun run test:coverage
```

## Deployment

### AWS Infrastructure
All services deploy to AWS ECS Fargate in the `us-east-1` region (account: 905418423235).

**Environments**:
- **Production**: main branch → api.suwappu.bot, app.suwappu.bot
- **Development**: dev branch → devapi.suwappu.bot, devfront.suwappu.bot

### Deployment Skill
Use the `/deploy` skill to deploy services:
```bash
/deploy         # Interactive deployment menu
/deploy webapp  # Deploy webapp only
/deploy api-ts  # Deploy TypeScript API only
```

The deploy skill handles:
- Building Docker images
- Pushing to ECR
- Updating ECS services
- Health checks

### Manual Deployment
```bash
# Deploy TypeScript API
cd api-ts
./ecs/setup-dev.sh  # First time setup

AWS_PROFILE=Swappu aws ecs update-service \
  --cluster suwappu-cluster \
  --service suwappu-api-ts-dev \
  --force-new-deployment

# View logs
aws logs tail /ecs/suwappu --filter-pattern api-ts-dev --follow --profile Swappu
```

### CI/CD Pipeline
GitHub Actions automatically deploy on push:
- Push to `main` → Production
- Push to `dev` → Development
- Only deploys if relevant files changed (path filters)

**Workflows**:
- `.github/workflows/deploy-api-ts.yml` - TypeScript API
- `.github/workflows/deploy-webapp.yml` - Webapp
- Path-based triggers prevent unnecessary deployments

### Health Checks
```bash
# Check production
curl https://api.suwappu.bot/health

# Check development
curl https://devapi.suwappu.bot/health

# Or use the health check script
python health_check.py
```

## Custom Skills

This repository has custom Claude Code skills:
- `/deploy` - Deploy services to AWS ECS (webapp, api-ts, bot)
- `/worktree` - Manage git worktrees for parallel development
- `/ralph-loop` - Start/cancel Ralph Loop for autonomous development

Use `/help` in Claude Code to see all available commands.
