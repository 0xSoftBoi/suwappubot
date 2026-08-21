# 0004 — Telegram polling implies a single bot replica

**Status**: Accepted (backfilled 2026-08; decision predates this record)

## Context

Telegram offers two update-delivery modes: long polling (bot pulls) and
webhook (Telegram pushes). Polling is simpler locally and needs no public
URL/TLS, but Telegram delivers each update to whichever poller asks —
two polling replicas both receive and process user commands, including swaps.

## Decision

Default is **polling with exactly one bot replica** (`USE_WEBHOOK=false`).
Horizontal scaling of the Python service requires switching to webhook mode
(`USE_WEBHOOK=true`, `POST /telegram/webhook` in `api/main.py`), which is
replica-safe.

## Consequences

- The python-api Railway service must stay at 1 replica while polling.
  Scaling it without flipping the flag **double-executes commands, including
  money-moving ones** — this is the failure mode this ADR exists to prevent.
- All ~23 lifespan background services (see `docs/architecture/OVERVIEW.md`)
  ride in the same single process; its downtime is total bot downtime.
- Local dev uses polling; prod webhook adoption is the gate for any
  multi-replica plan.
