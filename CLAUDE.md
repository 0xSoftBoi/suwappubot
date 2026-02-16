# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Git Conventions

- **IMPORTANT**: Do NOT add "Co-Authored-By" lines to commit messages.

## Project Overview

Suwappu is a cross-chain DEX bot and liquidity infrastructure for swapping tokens across 7+ chains.

- **Python Monolith** (`api/` + `bot/`): FastAPI service running Telegram bot + legacy API
- **TypeScript API** (`api-ts/`): Hono + Effect-TS API for agents and webapp
- **Webapp** (`webapp/`): React + Vite Telegram Mini App
- **Mobile** (`mobile/`): Expo iOS app
- **Showcase** (`showcase/`): Next.js homepage

Deploys to AWS ECS Fargate (us-east-1). See `docs/deployment/`.

## Commands

### Python Bot + API
```bash
uvicorn api.main:app --host 0.0.0.0 --port 8000 --reload  # Run monolith
pytest tests/                                               # Run tests
pytest tests/ --cov=bot --cov=api                           # Tests + coverage
pytest tests/test_wallet.py::test_create_wallet -v          # Single test
docker-compose -f docker-compose.local.yml up               # Local (polling)
docker-compose up                                           # Production (webhook)
```

### TypeScript API (api-ts)
```bash
cd api-ts
bun install && bun run dev       # Hot reload dev server
bun run build                    # Build for production
bun run check                    # TypeScript type checking
bun run db:generate              # Generate Drizzle migration files
bun run db:push                  # Push schema changes to database
bun run db:studio                # Open Drizzle Studio GUI
```

### Webapp (Telegram Mini App)
```bash
cd webapp
npm install && npm run dev       # Vite dev server
npm run build                    # Build for production
npm run test                     # Unit tests
npm run test:integration         # Integration tests
npm run test:all                 # All tests
```

### Mobile (Expo iOS)
```bash
cd mobile && bun install && bun run ios
```

## Architecture Gotchas

**Polling vs Webhook** (Python Bot):
- `USE_WEBHOOK=false` (default): Bot polls Telegram. **Single instance only** — multiple replicas = duplicate messages.
- `USE_WEBHOOK=true`: Telegram pushes updates. Safe for multiple replicas.

**No Alembic**: Runtime migrations in `database/db.py` via `_ensure_schema()`. All migrations are additive + idempotent. See `docs/development/migrations.md` or use `/migrations` skill.

**Wallet Encryption**: Default `kms_aesgcm_v2` (envelope encryption with KMS). Legacy `legacy_fernet_v1` auto-migrates to v2.

**Settings**: Python in `bot/config/settings.py` (pydantic-settings), TypeScript in `api-ts/src/config/EnvService.ts` (Effect Layer).

**Shared Types**: `packages/shared/` contains TypeScript types used by api-ts, webapp, and mobile. Changes affect all three.

**Background Services**: Started in `api/main.py` lifespan — `fee_sweeper`, `alert_service`, `order_service`, `tx_poller`, `health_monitor`, `launch_detector`. These are async tasks, not separate processes.

**Effect-TS** (api-ts): Uses `Context.Tag` + `Layer` + `ManagedRuntime`. Don't mix raw Promises with Effect pipelines — use `Effect.tryPromise()` to wrap async code.

## Key Directories

| Directory | Purpose |
|-----------|---------|
| `api/` | Python FastAPI endpoints, webhook handlers |
| `api-ts/` | TypeScript API (Hono + Effect-TS + Drizzle ORM) |
| `bot/handlers/` | Telegram command handlers (start, swap, wallet, etc.) |
| `bot/services/` | Business logic — swap engines, wallet management, alerts |
| `bot/models/` | SQLAlchemy models |
| `bot/config/` | Settings, token configs, chain configs |
| `bot/utils/` | Encryption, rate limiting, formatters, caching |
| `database/` | DB init, runtime schema migrations (`_ensure_schema()`) |
| `packages/shared/` | Shared TypeScript types across api-ts, webapp, mobile |
| `webapp/` | React + Vite Telegram Mini App |
| `mobile/` | Expo iOS app |
| `infra/` | AWS CDK infrastructure definitions |

## Deployment

**Environments**:
- **Production**: `main` branch → api.suwappu.bot, app.suwappu.bot
- **Development**: `dev` branch → devapi.suwappu.bot, devfront.suwappu.bot

CI/CD via GitHub Actions — pushes to `main`/`dev` auto-deploy if relevant files changed. See `docs/deployment/ci_cd.md`.

```bash
curl https://api.suwappu.bot/health       # Check production
curl https://devapi.suwappu.bot/health     # Check development
```

Use `/deploy` skill for manual deployments.

## API & Bot Reference

**Bot commands**: `/start`, `/s` (swap), `/w` (wallet), `/b` (balance), `/p` (portfolio), `/a` (alerts), `/o` (orders), `/snipe`, `/ref`, `/xp`. Admin: `/st`, `/hw`, `/fee`, `/m`.

**TypeScript API routes**: See `api-ts/src/routes/` — agent routes (`/v1/agent/*`), webapp routes (`/webapp/*`), swap routes, A2A protocol.

**Python API routes**: `GET /health`, `POST /telegram/webhook`, `POST /webhook` (WhatsApp).

## Custom Skills

- `/deploy` — Deploy services to AWS ECS
- `/worktree` — Manage git worktrees for parallel development
- `/migrations` — Database migration tutorial
- `/new-handler` — Add a new Telegram bot command handler
- `/new-route` — Add a new TypeScript API endpoint
- `/new-page` — Add a new webapp page/feature
- `/new-test` — Write tests for a feature
