# Architecture Overview

Ground-truth map of what runs in production and how the pieces talk. Extracted
from code (Aug 2026); when this drifts from source, source wins — update this
file in the same PR as the change.

Companion to root [`ARCHITECTURE.md`](../../ARCHITECTURE.md), which holds the
*normative* side: decision taxonomy (Core/Capability/Convention/Implementation),
the auth boundary (no email/password, by design), the `capabilities.yaml` and
`.env.schema` contracts, and superseded defaults. This file is the
*descriptive* runtime inventory.

## Services

| Service | Entry point | Role |
|---------|------------|------|
| Python monolith | `api/main.py` (FastAPI + lifespan) | Telegram bot (polling or webhook), WhatsApp webhook, auth, legacy API, all background services |
| api-ts | `api-ts/src/index.ts` (Bun + Hono) | Agent API (`/v1/agent/*`), webapp routes (`/webapp/*`), A2A JSON-RPC, MCP endpoint, swap routes |
| webapp | `webapp/` (React + Vite) | Telegram Mini App; calls api-ts |
| mobile | `mobile/` (Expo iOS) | iOS client; uses api-ts + `packages/shared` types |
| showcase | `showcase/` (Next.js) | Public homepage/marketing |
| terminal | `terminal/` (Docker) | Standalone swap UI, proxied via api-ts |

All deploy to **Railway** (`main` → prod, `dev` → dev). In prod,
`api.suwappu.bot` is **api-ts**; the Python service only has a
`*.up.railway.app` host.

## Request flows

- **Telegram** → `POST /telegram/webhook` (`api/main.py`) or long-polling when
  `USE_WEBHOOK=false` (single replica only!) → handlers registered by
  `bot/main.py:add_handlers()` (`bot/handlers/*`).
- **Webapp** → api-ts `/webapp/*` routes; auth via Telegram initData or wallet
  signature.
- **Agents** → api-ts: A2A at `POST /a2a` (Bearer auth), agent card at
  `/.well-known/agent-card.json`, execution at `POST /v1/agent/execute`,
  MCP at `POST /mcp` (rate-limited).

## Background services (the invisible half of the bot)

`api/main.py`'s lifespan starts ~23 async tasks in-process (staggered ~2s
apart, around `api/main.py:342-458`). These are tasks, not processes — if the
monolith is down, all of them are down. Highlights:

- **Money-moving**: `fee_sweeper`, `order_service` (limit/DCA), `tx_poller`,
  `withdraw_reconciler`, `cctp_relayer` + `cctp_generic_relayer`,
  `btc_bridge_poller` (conditional)
- **Market/position monitors**: `perps_monitor`, `hl_ecosystem_monitor`,
  `hl_ws_alerts`, `predict_monitor`, `morpho_monitor` (conditional),
  `execution_scorer`
- **User-facing**: `alert_service`, `balance_refresher`, `approval_notifier`,
  `digest_service`, `discord_alerts`
- **Plumbing**: `health_monitor`, `webhook_dispatcher`, `event_bus`
  (Redis pub/sub), internal `api_client`, WhatsApp send queue

When adding a service: start it in the lifespan, make it crash-isolated, and
give `health_monitor` a way to see it.

## Data layer

One **PostgreSQL** database (SQLite fallback for local dev), shared by both
stacks:

- **Python**: SQLAlchemy models in `bot/models/`; schema created/migrated at
  boot by `_ensure_schema()` in `database/db.py` — additive + idempotent only,
  no Alembic. Pool 15–40 conns per instance.
- **TypeScript**: Drizzle schemas in `api-ts/src/db/schema/` (users, swaps,
  payments, perps, seasons, dcaOrders, …); `bun run db:push` applies changes.

Any schema change must land on **both** sides — CI has a Postgres contract job
that checks Python-migration ↔ Drizzle idempotency. Use the `/migrations`
skill or `db-migrate` agent.

## Chains & swap providers

- **~46 chains** configured in `bot/config/chains.py` (EVM majors + Solana,
  TRON, StarkNet; base-sepolia for testing). Count from config, not docs.
- **15 swap/bridge providers** dispatched by `bot/services/swap_engine.py`:
  Jupiter+Jito, SunSwap, OKX DEX, 0x (spot + cross-chain), Li.Fi,
  LayerZero/Stargate, CoW, Socket, Circle CCTP, Across, Wormhole, CCIP,
  1inch, KyberSwap. Providers are raced in parallel; best quote wins.

## Wallets & keys (money path)

- Private keys are stored encrypted in the `Wallet` model. Default scheme is
  `kms_aesgcm_v2` (KMS envelope encryption); `legacy_fernet_v1` blobs
  auto-migrate on read. See `docs/KMS_AWS_MIGRATION.md`.
- Keys are decrypted on-demand at signing time in the swap path
  (`bot/services/swap_engine.py`); custodial operations (fee sweeps,
  withdrawals) go through `bot/services/hot_wallet.py`.
- **Every diff touching these modules is MONEY-PATH** and requires adversarial
  review before merge.

## Where to go deeper

- Deploy/ops: `docs/deployment/railway.md`, `docs/deployment/monitoring.md`
- Migrations: `docs/development/migrations.md`
- Key management: `docs/KMS_AWS_MIGRATION.md`, `docs/SECRET_ROTATION_RUNBOOK.md`
- Decisions & lessons: `docs/DECISIONS.md`
- New-contributor setup: `docs/ONBOARDING.md`
