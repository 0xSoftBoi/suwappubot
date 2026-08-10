# 0005 — Dual stack: Python monolith + TypeScript API over one database

**Status**: Accepted (backfilled 2026-08; decision predates this record)

## Context

The product started as a Python Telegram bot (python-telegram-bot + FastAPI).
The agent platform (A2A, MCP, agent REST) and webapp needed a typed API with
shared TypeScript types across webapp/mobile, which the Python monolith could
not provide without a rewrite.

## Decision

Run **two stacks over one PostgreSQL database**:

- **Python monolith** (`api/` + `bot/`): Telegram/WhatsApp UX, swap execution,
  wallets, and all background services — the money-moving core.
- **api-ts** (`api-ts/`, Hono + Effect-TS + Drizzle): agent surface (A2A, MCP,
  `/v1/agent/*`), webapp/mobile API, with `packages/shared/` types consumed by
  webapp, mobile, and SDKs.

Rather than a rewrite or internal RPC between them, both read/write the shared
DB directly (schema discipline per ADR 0003).

## Consequences

- New features must pick a home: user-chat + execution → Python; agent/web
  surface → api-ts. Features spanning both need coordinated changes and shared
  understanding of the tables involved.
- Cross-stack invariants (fee math, balances, seasons/points) exist in two
  codebases — a known bug-class; sweep both stacks when fixing one
  (`/bugclass` skill).
- Effect-TS idioms apply in api-ts only: wrap Promises with
  `Effect.tryPromise()`, never mix raw Promises into pipelines.
- `packages/shared/` changes ripple to api-ts, webapp, and mobile at once.
