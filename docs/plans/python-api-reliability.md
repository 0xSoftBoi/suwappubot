# Python API Reliability Plan

**Date:** 2026-08-31 · **Branch:** `claude/python-api-reliability-1jtjq9`

## Evidence (Railway logs + GitHub history)

- **Deploys fail at the health gate, not with crashes.** Deploy `40500bc` (PR #979, Aug 31) served
  `/health` → 503 for 10 minutes until Railway killed it. `/health` 503s only when
  `DATABASE_AVAILABLE` is false (`api/main.py:1285`), so anything that blocks DB init — the
  boot-time `CREATE INDEX` on hot tables fixed in PR #980 — bricks the whole deploy.
- **Background tasks die silently.** `asyncio.create_task()` handles are discarded
  (`api/main.py:290,311,369,490`); an unhandled exception kills the loop unobserved. The only
  detection is a Redis heartbeat going stale 90+ seconds later. No restart, no alert.
- **CI green ≠ the bot boots.** `pytest tests/` never imports `api.main` / `bot.main`, so
  import-time crashes pass CI and crash Railway (already a "standing rule" lesson in CLAUDE.md,
  but still unenforced by CI).
- **Log severity is garbage in Railway.** Everything (INFO included) goes to stderr, so Railway
  marks every line `severity=error`. Real errors are indistinguishable, and `rpc_manager`
  circuit-OPEN warnings flood the stream (~100s of lines/hour for permanently dead public RPCs).

## Enterprise practice (researched, cited in session)

1. Supervised background tasks: every task handle stored, done-callback logs the exception,
   crashed loops restart with jittered exponential backoff (Quantlane/SuperFastPython pattern).
2. Deploy-gating health endpoint stays cheap (DB only); deep diagnostics live on a separate path.
   Railway healthcheck gates traffic cutover on 200.
3. Retries with jitter + circuit breakers around external deps (already present:
   `bot/utils/retry.py`, `rpc_manager` circuit breaker — reuse, don't rebuild).
4. Fail-fast config validation at startup with a clear error (pydantic-settings — present).
5. Structured logs with correct severities; alert on new error types, not every occurrence.

## Fixes (ranked, this branch)

| # | Fix | Files |
|---|-----|-------|
| 1 | Supervisor for background tasks: `bot/utils/task_supervisor.py` — spawn/track named tasks, done-callback logging, restart with jittered backoff, expose crash state; wire into lifespan tasks (`polling`, `discord`, fingerprint republisher, auth cleanup) | `bot/utils/task_supervisor.py`, `api/main.py` |
| 2 | Surface dead tasks in `/health/ready` `degraded` list (never flips 503 — Railway gate stays DB-only) | `api/main.py` |
| 3 | Log-severity split: INFO/WARNING → stdout, ERROR+ → stderr so Railway severities are truthful | `api/main.py` (logging setup) |
| 4 | Rate-limit repeat `RPC circuit OPEN` warnings: first open per endpoint logs WARNING, re-opens within a window log DEBUG | `bot/services/rpc_manager.py` |
| 5 | CI boot-import gate: `scripts/ci/boot_import_check.py` imports `api.main` + `bot.main` with stub env; new step in test workflow | `scripts/ci/`, `.github/workflows/test.yml` |
| 6 | Boot warning when `RAILWAY_SERVICE_INSTANCE_COUNT` is unset while polling is enabled (silent multi-replica 409 risk) | `api/main.py` |
| 7 | Graceful shutdown: cancel + await supervised tasks with timeout | `api/main.py` |

## Out of scope (deliberately)

- Sentry wiring (needs a DSN/product decision), RPC endpoint list curation (config change, not
  code), DB pool resizing (no observed exhaustion incident), replacing the existing
  retry/circuit-breaker utilities with tenacity (they work; reuse-before-build).

## Verification

- `pytest tests/` green, `black --check` clean, new boot-import gate passes locally.
- Post-merge: `python3 scripts/status.py` + Railway logs show INFO lines at severity info and no
  circuit-OPEN flood.
