# COO Operational Audit — Suwappu (2026-08-15)

Scope: background service crash behavior, polling/webhook replica safety, monitoring blind
spots, status.py/verify.sh coverage, deploy-vs-boot risk. Read-only.

---

## Finding 1 — SEVERITY: HIGH
**File:** `api/main.py:310-459` (lifespan, "5. Start Background Services")
**Issue:** 18+ background services (fee_sweeper, alert_service, market_data_service,
venue_data_service, order_service, tx_poller, withdraw_reconciler, health_monitor,
balance_refresher, approval_notifier, webhook_dispatcher, execution_scorer, perps_monitor,
hl_ecosystem_monitor, predict_monitor, hl_ws_alerts, cctp_relayer, cctp_generic_relayer,
digest_service, btc_bridge_poller, morpho_monitor) are started with bare sequential
`await x.start(...)` calls — no per-service try/except, unlike the explicit
`_track_degraded()` wrapper used for p2p_escrow, discord_alerts, event_bus,
internal_api_client, whatsapp_queue, auth_challenge_cleanup.
**Operational consequence:** any one `.start()` raising (e.g. `order_service.start()` at
line 379 constructs `SwapEngine()`, which instantiates ~8 provider API clients — CoW,
Socket, Jito, LiFi, Jupiter, LayerZero, CCIP) propagates out of `lifespan()`, aborts
FastAPI startup, and Railway marks the deploy CRASHED. One misbehaving service (e.g. a
bad env var breaking a provider client constructor) takes down the entire bot + API, not
just that feature — the opposite of the fault-isolation pattern the codebase already uses
elsewhere.
**Fix:** wrap each `.start()` call in the same `_track_degraded()` context manager already
defined in this file, or a dedicated variant for tasks (vs. one-shot init) that logs +
marks degraded rather than raising into the lifespan.

## Finding 2 — SEVERITY: HIGH
**File:** `api/main.py:1185-1199` (`/health/ready` `watched_services` list)
**Issue:** Of the services that write a Redis heartbeat, only `tx_poller`,
`withdraw_reconciler`, `balance_refresher`, `perps_monitor`, `predict_monitor`,
`execution_scorer`, and conditionally `hl_ws_alerts` are checked. Confirmed NOT watched
despite writing heartbeats: `hl_ecosystem_monitor` (bot/services/hl_ecosystem_monitor.py:59)
and `battle_monitor` (bot/services/battle_monitor.py:55) — dead heartbeats, nobody reads
them. Confirmed NOT watched AND writing no heartbeat at all: `btc_bridge_poller`,
`cctp_relayer`, `cctp_generic_relayer`, `fee_sweeper`, `alert_service`, `order_service`,
`digest_service`, `morpho_monitor`, `approval_notifier`, `webhook_dispatcher`.
**Operational consequence:** the BTC bridge poller (bot/services/btc_bridge_poller.py) is
the single point that advances every in-flight Lightning/BTC swap on Starknet. If its
`_loop()` task dies (e.g. an exception in `asyncio.create_task` itself, or the process
silently drops the task reference), user funds sit in an intermediate swap state
indefinitely with **zero alerting** — `/health/ready` stays green, `scripts/status.py`
stays green, the uptime probe stays green. Same blind spot for CCTP relayers (funds stuck
mid-bridge) and fee_sweeper (protocol fees silently stop being collected for weeks — this
is not hypothetical, see `digest_service`/worker-fingerprint comments in main.py describing
an actual multi-day-invisible incident of the same shape).
**Fix:** (a) add heartbeat writes to `btc_bridge_poller`, `cctp_relayer`,
`cctp_generic_relayer`; (b) add all of the above to `watched_services` with per-service
staleness thresholds matching their poll interval (btc_bridge_poller = 20s → ~90s
threshold); (c) delete or wire up the two heartbeats that are currently written and never
read (`hl_ecosystem_monitor`, `battle_monitor`) so their presence isn't mistaken for
coverage.

## Finding 3 — SEVERITY: MEDIUM
**File:** `docs/deployment/monitoring.md` (Known gaps), `scripts/status.py`,
`scripts/verify.sh`
**Issue:** No Turnkey-specific health check anywhere. `grep -ri turnkey` across
`scripts/` and `monitoring/` returns nothing except unrelated key-rewrap scripts.
`auth_challenge_cleanup` (api/main.py:464-474) is the only Turnkey-adjacent loop, and it's
non-fatal/self-healing by design — it says nothing about whether Turnkey's remote API is
actually reachable. A Turnkey outage would surface only as user-facing 401s on
`/auth/turnkey/verify` (api/main.py:1346), with no server-side signal until users complain.
**Operational consequence:** custodial wallet sign-in (and any Turnkey-backed swap signing)
degrading is invisible to every one of the 5 monitoring layers described in
`docs/deployment/monitoring.md`.
**Fix:** add a lightweight Turnkey reachability check to `/health/ready` (cached, short
TTL, non-blocking) and list it in `monitoring/endpoints.json` deep-check subsystems.

## Finding 4 — SEVERITY: MEDIUM
**File:** `scripts/verify.sh:57-61` ("Production health" lane)
**Issue:** `bash scripts/verify.sh health` curls `https://api.suwappu.bot/health`, which is
the **api-ts** service (CLAUDE.md and `scripts/status.py:60-63` both document this
explicitly). The Python bot has no custom domain in prod and is never checked by
`verify.sh` at all.
**Operational consequence:** running the documented pre-push verification gate gives zero
signal on whether the Telegram bot boots. This is exactly the "CI green ≠ bot boots" gap
CLAUDE.md calls out as a standing rule — but the gap exists inside the verification
tooling itself, not just in CI. Someone running `verify.sh` and trusting a green result
would ship a bot-breaking import error.
**Fix:** add a second curl in the `health` lane against
`https://python-api-production-8526.up.railway.app/health` (or read it from
`monitoring/endpoints.json` to stay single-sourced), or explicitly rename the current
check to `api-ts-health` so nobody mistakes it for bot coverage.

## Finding 5 — SEVERITY: LOW (control confirmed working)
**File:** `api/main.py:253-278`, `railway.python-api.json:21`
**Issue:** none — verifying the polling/replica question. Two independent controls exist:
(1) `railway.python-api.json` pins `numReplicas: 1` at the platform level; (2) `api/main.py`
reads `RAILWAY_SERVICE_INSTANCE_COUNT` at boot and refuses to start `getUpdates` polling if
it's `>1`, logging an ERROR and leaving `polling_task = None` (bot goes headless rather than
double-polling). Checked all `railway*.json` in repo — every service pins `numReplicas: 1`.
No config path found that could produce 2 polling replicas under current settings
(`USE_WEBHOOK` defaults false per CLAUDE.md).
**Residual risk:** the guard trusts `RAILWAY_SERVICE_INSTANCE_COUNT` being set/accurate on
every replica; if Railway ever fails to inject it (env unset → defaults to 1 = "safe"), a
manually-scaled deploy that bypasses `railway.python-api.json` (e.g. dashboard override)
would only be caught if the env var is actually set by the platform at that scale — not
verified against a live 2-replica deploy in this audit (would require a disruptive test).
**Fix:** none required now; if scaling python-api is ever considered, confirm this env var
live before relying on the code guard alone.

---

## Summary — what's most likely to bite operationally

**Finding 1 is the one thing most likely to go wrong.** It's a single-point-of-failure
architecture applied to 18 independent services: today's fault-isolation gaps (Findings 2
and 3) mean a stuck bridge or dead poller fails silently, but Finding 1 means a much more
common failure — one provider client throwing on init, one bad env var — takes the *entire*
bot + API down on every deploy, converting a feature-level bug into a full outage. The fix
is mechanical (reuse `_track_degraded`) and should ship before the bridge/heartbeat gaps
are closed, since it also protects whatever heartbeat-writing changes Finding 2 introduces.

Coverage note: did not test a live 2-replica Railway deploy (Finding 5) or a live Turnkey
outage (Finding 3) — both would require disruptive/staging changes outside a read-only
audit. Did not audit `cctp_relayer.py` / `cctp_generic_relayer.py` internals line-by-line
(inferred no-heartbeat from the grep in Finding 2's evidence, not a full read).
