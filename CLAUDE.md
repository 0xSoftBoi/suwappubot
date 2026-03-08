# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Workflow
- **IMPLEMENT, don't plan.** When asked to fix or build something, DO the work. If you need to explore first, limit exploration to 5 minutes then start building. Only produce a plan document if explicitly asked for one.
- If blocked, say so explicitly — don't fill the response with exploration as a substitute for implementation.

## Git Conventions

- **IMPORTANT**: Do NOT add "Co-Authored-By" lines to commit messages.

## Git Operations

**Before any git push, rebase, or merge**, run this mandatory pre-flight sequence. Do NOT skip steps. Only proceed after reporting all findings. If any issue is found, fix it first and re-run.

### Pre-flight checklist (run every time):
1. **Build artifacts**: Check for `.next/`, `node_modules/`, `dist/` in tracked files. If found, add to `.gitignore` and unstage before proceeding.
2. **Lock files**: Run `ls .git/*.lock 2>/dev/null` — if stale lock files exist, investigate what holds them (don't just delete).
3. **Worktree check**: Run `git rev-parse --git-common-dir` — if in a worktree, **NEVER rebase**. Always use `git merge` or `git pull --no-rebase`.
4. **Divergence check**: Compare `git rev-parse HEAD` vs `git rev-parse @{u}` to detect local/remote divergence. Recommend merge (not force-push) unless user explicitly approves.
5. **Uncommitted work**: Run `git status` and `git stash list` to surface any uncommitted changes or stashed work. Report before proceeding.

### Additional rules:
- **NEVER use `git rebase`**. Always use `git merge` or `git pull --no-rebase`.
- **If any git operation fails twice, STOP and ask the user** — do NOT attempt dozens of recovery steps.
- Use `HUSKY=0` prefix for all git commits and pushes in worktrees to avoid hook hangs.

## Build Tools
- **Always use `bun`** instead of `tsc`, `npm`, or `npx`. The `tsc` command times out in this project.
- **Use `gh`** (GitHub CLI) for all GitHub operations.
- Component-specific rules are in `.claude/rules/` (api-ts, webapp, bot, showcase).

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

## Verification

**RULE: Do NOT claim a deployment or change is done without running `scripts/verify.sh` first.** If you make a claim, you must have verified it.

```bash
bash scripts/verify.sh        # Run all checks
bash scripts/verify.sh api    # Run only api-ts checks
bash scripts/verify.sh agent  # Run only agent card/registry checks
```

## Custom Skills

- `/deploy` — Deploy services to AWS ECS
- `/worktree` — Manage git worktrees for parallel development
- `/migrations` — Database migration tutorial
- `/new-handler` — Add a new Telegram bot command handler
- `/new-route` — Add a new TypeScript API endpoint
- `/new-page` — Add a new webapp page/feature
- `/new-test` — Write tests for a feature
