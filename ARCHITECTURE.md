# Architecture

This document describes the system boundaries, layering, and standing architectural
decisions for Suwappu. Precedence for contributors and agents: `AGENTS.md` (agent policy)
→ this file (boundaries and decisions) → `CONVENTIONS.md` (day-to-day rules). Deployment
detail lives in `docs/deployment/`; the working code is ground truth when docs drift.

## System map

| Service | Stack | Role |
|---------|-------|------|
| Python monolith (`api/` + `bot/`) | FastAPI, python-telegram-bot, SQLAlchemy | Telegram bot, WhatsApp webhook, legacy API, background services |
| TypeScript API (`api-ts/`) | Hono, Effect-TS, Drizzle | Agent API (`/v1/agent/*`), webapp API (`/webapp/*`), swaps, A2A protocol, MCP |
| Webapp (`webapp/`) | React, Vite | Telegram Mini App |
| Mobile (`mobile/`) | Expo | iOS app |
| Showcase (`showcase/`) | Next.js | Public homepage, docs, status page |
| `packages/shared` | TypeScript | Types shared by api-ts, webapp, mobile |
| `packages/design-tokens` | TypeScript | Tokens, Tailwind preset, CSS vars, RN mapping |
| `packages/sdk`, `packages/sdk-python`, `packages/openclaw` | TS / Python | Client SDKs kept in sync with the API |

Deploy target is **Railway** (`main` → prod, `dev` → dev). The `infra/` AWS CDK tree is
legacy and unused for app deploys.

## Decision taxonomy

Every architectural choice falls into one of four classes, each with its own change rule:

- **Core** — changing it is a rewrite; requires explicit maintainer sign-off.
  Examples: Postgres as the datastore; Telegram as the primary identity surface;
  Railway as the deploy target; envelope encryption for wallet keys.
- **Capability** — optional provider behind configuration; may be enabled, disabled, or
  swapped without touching core. Declared in `capabilities.yaml` (the manifest is the
  truth source: an adapter existing in code does not mean the capability is live).
- **Convention** — a rule in `CONVENTIONS.md`; change by PR that updates the doc and the
  code together.
- **Implementation** — local detail; change freely within the conventions.

## Data layer

- **Postgres-first.** One database, two ORMs: SQLAlchemy models in `bot/models/`,
  Drizzle schemas in `api-ts/`. A schema change is not done until both sides agree
  (use the `db-migrate` path in `AGENTS.md`).
- **Runtime migrations, deliberately.** There is no Alembic. `database/db.py
  _ensure_schema()` applies additive, idempotent migrations at boot. This is a standing
  Core decision traded against reviewed-migration purity: the bot deploys as a single
  writer and additive-only changes cannot corrupt existing data. The constraints that
  make it safe are hard rules: **additive only, idempotent always** — no destructive
  DDL at startup, ever. See `docs/development/migrations.md`.

## Money path and key handling

- Wallet private keys are encrypted with envelope encryption (`kms_aesgcm_v2`, KMS-backed);
  `legacy_fernet_v1` material auto-migrates on read. Key handling code is Core.
- Any diff touching swap execution, wallet/keys, KMS, billing/x402, fee math,
  seasons/points, or withdrawals is a **MONEY-PATH** change and requires the adversarial
  review gate before merge (see `AGENTS.md`).

## Authentication — a deliberate boundary

There is **no email/password auth, by design**. Identity enters through surfaces that are
stronger for a custodial wallet product than passwords would be:

- Telegram `initData` verification for the Mini App → short-lived JWT
  (`api-ts/src/middleware/flexAuth.ts`).
- Agent API keys for `/v1/agent/*`.
- TOTP 2FA (`bot/handlers/twofa.py`) gates sensitive operations.
- DKIM-verified email social recovery (`bot/handlers/recovery.py`) replaces
  "forgot password".
- Spending limits (`bot/services/spending_limits.py`) bound blast radius even after
  auth compromise.

Authorization is enforced server-side at the route boundary; client-visible state is
never proof of permission.

## Configuration contract

Settings are schema-validated in code — `bot/config/settings.py` (pydantic-settings) and
`api-ts/src/config/EnvService.ts` (Effect Schema). The repo-root `.env.schema` is a
**generated artifact** derived from those sources (`python3 scripts/check_env_schema.py
--write`); CI fails if it drifts. Code is the source of truth; the schema file is the
human- and agent-readable contract. Secrets live only in deployment config and ignored
env files — never in the repo.

## Background services

Started in `api/main.py` lifespan as async tasks (not separate processes): `fee_sweeper`,
`alert_service`, `order_service`, `tx_poller`, `health_monitor`, `launch_detector`.
Polling vs webhook is a Core operational constraint: `USE_WEBHOOK=false` means exactly
one bot replica.

## Contract-first API surface

The OpenAPI spec for the agent API is generated from the route code
(`api-ts/scripts/gen-openapi.ts` → `openapi-agent.json`, served at `/v1/agent/openapi`).
The checked-in spec is drift-gated in CI (`bun run openapi:check`) — hand-editing it is
forbidden; change the routes and regenerate.

## Observability

Structured logs: pino in api-ts, stdlib logging in the Python services.
`python3 scripts/status.py` is the operator entry point (Railway control plane + deep
health + log scan + CI in one shot); layer-by-layer monitoring coverage is documented in
`docs/deployment/monitoring.md`. OpenTelemetry request tracing is an optional capability
for api-ts (`opentelemetry_tracing_api_ts` in `capabilities.yaml`): off by default, and
when `OTEL_ENABLED` is unset none of the SDK is even imported. Spans carry
method/route/status only — never headers, bodies, or credentials.

## Superseded / rejected defaults

- AWS ECS/EC2 deploys — superseded by Railway (`infra/` retained for reference only).
- Email/password auth — rejected; see Authentication above.
- Hand-maintained API specs — rejected; specs are generated and drift-gated.
- Schema changes at startup beyond additive+idempotent — forbidden.
