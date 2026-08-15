---
description: "Check what's actually running: Railway control plane + deep health + logs + CI. Usage: /status [prod|dev] [--quick]"
---

# Suwappu Status Skill

One command to answer **"is anything broken right now?"** across all Railway
services. Run this **before** diagnosing anything and **after** every deploy.

```bash
python3 scripts/status.py              # full check (prod)
python3 scripts/status.py --quick      # skip log scan — fast
python3 scripts/status.py --env dev
python3 scripts/status.py --json       # machine-readable (cron/CI)
python3 scripts/status.py --logs api-ts --lines 300   # dump one service's logs
```

Exit codes: `0` healthy, `1` degraded/down, `2` could not determine.

## Why this exists (read before reaching for another tool)

We have three overlapping health tools and they check **different layers**. Using
the wrong one is how outages get missed:

| Tool | Layer | Blind spot |
|---|---|---|
| `.github/workflows/health-check.yml` | public HTTP, every 10 min | only services with a public URL |
| `scripts/monitor.sh` | public HTTP + log classification | same — no control plane |
| `scripts/health-triage.sh` | one endpoint + Claude root-cause | single service |
| **`scripts/status.py`** | **Railway control plane + HTTP + logs + CI** | needs `railway` CLI auth |

**The blind spot that matters:** `python-worker`, `suwappu-relayer` and
`suwappu-bridge` have no public health URL. They can crash-loop or fail to deploy
and *every HTTP probe still returns 200*. Only `status.py` sees this, because it
reads Railway's deployment state directly rather than inferring it from traffic.

The inverse failure is just as real: a **deploy can fail while the old container
keeps serving happily**, so health stays green while your new code is not live.
`status.py` shows deploy status and age, which makes that obvious.

## How it works

- Service list is **derived from Railway at runtime** (`railway status --json`),
  not hardcoded — new services are covered automatically instead of drifting out
  of a stale list.
- Probes run in parallel; log scanning only happens for services that already
  look unhealthy, so the common all-green path stays fast.
- For `python-api` it parses the deep `/health` payload and prints only the
  subsystems that are *not* healthy (db, redis, background-service heartbeats).

## Known gaps this tool does NOT close

1. **The 10-minute health cron is a single point of failure.** It runs on GitHub
   Actions, which silently stops when Actions billing fails — the job never
   starts, so the Telegram alert step never runs and **nobody is told that
   monitoring died**. This has happened (verified 2026-07-25: 8 consecutive
   `health-check` runs failed with "recent account payments have failed", after
   ~7 months of green). Uptime monitoring should move to a provider that does not
   depend on our own billing (UptimeRobot / Better Stack free tiers), with a
   dead-man's-switch so silence itself pages.
2. **No runtime error tracking.** Unhandled exceptions only exist in Railway logs,
   which are short-retention and un-searchable after the fact. There is no Sentry
   equivalent. The support-ticket system captures *user-filed* reports only — it
   never sees a crash the user did not bother to report.
3. `status.py` is **manual**. It is a much better *check*, not a *monitor*.

## Gotchas

- **Use `/health`, not `/health/ready`, on `api.suwappu.bot`.** They run the same
  deep check, but the Cloudflare Worker fronting that domain only proxies a fixed
  set of paths and 404s on `/health/ready`. The direct
  `python-api-production-8526.up.railway.app` URL serves both.
- `railway` CLI must be logged in (`railway whoami`). Without it the script exits
  `2` rather than pretending everything is fine.
- Requires the repo to be linked to the `suwappu` Railway project.
- **Deploy windows look like outages.** Railway serves 502 while a service
  restarts, and background heartbeats read `unknown`/`dead` until they first
  tick. The script retries non-2xx 3× and treats heartbeat staleness within
  5 minutes of a deploy as *warming up*, not degraded. If you see a service flip
  to degraded, check the deploy age before escalating.
- Services not provisioned in an environment (dev has no `terminal`/`showcase`/
  `suwappu-bridge`) report as `not deployed` and do **not** fail the exit code.
