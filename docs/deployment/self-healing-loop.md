# Self-healing deployment loop (Railway)

A bounded, approval-gated procedure for recovering a failed Railway deploy
without throwaway hacks. The harness is `scripts/self_heal_deploy.sh`; this doc
is the runbook a human or agent follows.

## Guardrails (non-negotiable)

1. **Never auto-deploy to production.** The `deploy` subcommand refuses unless
   `SELF_HEAL_CONFIRM=1` is set by a human who has approved that specific push.
2. **Billing / spend-limit blocks halt the loop immediately.** They are not code
   faults — do not redeploy, resolve billing in Railway (or escalate to the
   account owner) first. `diagnose` scans for this before anything else.
3. **Fix at the source, ranked-highest-first.** Test the top hypothesis before
   editing anything. No speculative patches to "see if it helps."
4. **Verify on the live surface**, not just the build: healthcheck **and** a
   real user-facing route must return 200 before declaring green.

## The loop

```
   ┌─> watch ──Online──> verify ──green──> DONE
   │     │
   │   FAILED
   │     ▼
   │  diagnose ──billing?──> HALT + escalate
   │     │ (ranked hypotheses)
   │     ▼
   │  human applies TOP fix at source  ──> get approval
   │     ▼
   └─ SELF_HEAL_CONFIRM=1 deploy ─┘   (repeat until verify is green)
```

## Commands

| Command | What it does | Writes? |
|---|---|---|
| `scripts/self_heal_deploy.sh status`   | Print `railway status` for the linked service | no |
| `scripts/self_heal_deploy.sh watch`    | Poll deploy state until Online/Failed/timeout | no |
| `scripts/self_heal_deploy.sh diagnose` | Pull build+runtime logs, flag billing, rank root-cause hypotheses | no |
| `scripts/self_heal_deploy.sh verify`   | Hit healthcheck + user-facing route | no |
| `scripts/self_heal_deploy.sh loop`     | status → watch → (verify \| diagnose). Never deploys | no |
| `SELF_HEAL_CONFIRM=1 … deploy`         | Gated `railway up` — **prod deploy, human-approved only** | YES |

## Configuration (env overrides)

| Var | Default | Meaning |
|---|---|---|
| `SELF_HEAL_SERVICE` | `python-api` | Railway service to act on |
| `SELF_HEAL_HEALTH_URL` | `https://api.suwappu.bot/health` | healthcheck endpoint |
| `SELF_HEAL_ROUTE_URL` | terminal prod URL | real user-facing route |
| `SELF_HEAL_LOG_SECONDS` | `25` | log-pull window |
| `SELF_HEAL_POLL_SECONDS` / `_POLL_MAX` | `15` / `40` | watch cadence / cap (~10min) |
| `SELF_HEAL_STATE_DIR` | `/tmp/suwappu-self-heal` | logs + `audit.log` location |

## Ranked root-cause hypotheses

`diagnose` matches log signatures against a confidence-ordered table and prints
the "first thing to check" for each hit. Highest-confidence classes:

1. **0.97 Boot import error** — `ImportError`/`ModuleNotFound`. Passes CI, crashes
   boot (CI doesn't exercise `bot/main.py`'s import chain). Check the import chain.
2. **0.95 Dependency/version incompat at construction** — e.g. the openai↔httpx
   `proxies` break (PR #566). Reproduce client construction locally.
3. **0.93 Syntax / async-sync mismatch** — `ast.parse` changed files; check
   `def` vs `async def` on the call chain.
4. **0.90 Healthcheck timeout** — app never bound `$PORT`; blocking call before uvicorn.
5. **0.88 Missing/blank required env var** — pydantic settings field required.
6. **0.85 DB / migration failure at startup** — Postgres reachable; migration
   additive+idempotent in `database/db.py`.
7. **0.80 Build step failed** — read the BUILD section; reproduce the build cmd.
8. **0.70 OOM during boot** — eager load at import time vs memory limit.

No signature match → manual triage on the tail (printed). Add new signatures to
the `HYPOTHESES` array as new failure modes are learned.

## Audit trail

Every hypothesis, action, and outcome is timestamped to
`$SELF_HEAL_STATE_DIR/audit.log`. Read it back after a heal to reconstruct what
was tried and why.

## Related

- `scripts/monitor.sh` — runtime health/flow classifier (swap/wallet/RPC), loopable.
- Railway deploy-failure webhook + GH Actions health cron (PR #567) — the passive
  alerting that tells you a heal is *needed*; this loop is the active response.
