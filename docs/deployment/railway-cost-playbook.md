# Railway cost playbook (researched 2026-09-07)

What actually moves the Railway bill for this project, ranked by expected $
impact, with what we've verified against Railway's docs/schema versus what is
community lore. Companion to [`railway-cost-audit.md`](railway-cost-audit.md)
(the measurements) — this is the "what people do about it" half.

## How Railway bills (verified)

- **Per-minute metering of actual usage**, priced per resource:
  **$10 / GB-RAM-month** and **$20 / vCPU-month** on Pro (the audit modelled RAM
  at $20 — the current docs say $10; re-check the pricing page before quoting
  absolutes). Egress $0.05/GB. There is no instance size to pick; a service
  scales vertically up to the plan ceiling (32 GB / 32 vCPU for us).
  Source: docs.railway.com/guides/right-size-cpu-memory, /pricing/plans.
- **Average, not peak, is what you pay.** "A service that spikes to 2 GB for
  five minutes a day but idles at 300 MB is billed almost entirely at 300 MB."
  For `python-worker` that means the ~2 GB *baseline* costs ~$20/mo, while a
  30 GB spike lasting ~30 min costs about $0.20. Spikes are a reliability
  problem and a tail-risk problem (a runaway that *doesn't* get killed is
  unbounded), not the main line item.
- **Replica/resource limits cap the worst case; they do not lower the bill.**
  Railway says so explicitly (docs.railway.com/pricing/cost-control). Set them
  anyway — they are the difference between a crash and a surprise invoice.
- **App sleeping does not apply to a worker.** Sleep triggers on *outbound*
  inactivity; a process polling RPCs and Postgres never goes quiet, and with no
  inbound HTTP nothing would wake it (docs.railway.com/reference/app-sleeping).
- **Regions are not a price lever** — no regional compute price differences
  are documented. Private networking (`*.railway.internal`) avoids egress.

## Levers for `python-worker`, in order

| # | Lever | Verified? | Expected effect | Status |
|---|-------|-----------|-----------------|--------|
| 1 | In-process RSS guard: diagnose at soft limit, `os._exit(137)` at hard limit | Our code | Turns a 30 GB SIGKILL into a 6 GB restart *with a tracemalloc report*; first real lead on the root cause | **Shipped** (`bot/services/memory_guard.py`) |
| 2 | `deploy.limitOverride.containers.memoryBytes` / `.cpu` in `railway.json` | **Yes** — present in `https://backboard.railway.app/railway.schema.json` (not documented on the deprecated config-as-code page) | Platform-side ceiling; OOM → exit 137 → `ON_FAILURE` restart | **Shipped** (8 GiB / 2 vCPU on the worker) |
| 3 | `MALLOC_ARENA_MAX=2` (+ `MALLOC_TRIM_THRESHOLD_`) | Community + Heroku's own guidance; effect size varies (20–50 % RSS in multi-threaded Python is typical) | Lower steady-state RSS from glibc arena fragmentation; SQLAlchemy sync sessions run in executor threads, which is exactly the pattern it targets | **Shipped** (`api/Dockerfile.railway`) |
| 4 | Periodic `malloc_trim(0)` | glibc documented behaviour | Returns freed heap after a spike instead of staying resident (resident is what's billed) | **Shipped** (guard trims every 15 min and after each excursion) |
| 5 | Don't import the Telegram handler tree in worker mode | Measured locally | Only ~20 MB RSS and 0.6 s at import — small; the 2 GB baseline is *runtime* growth (0.44 GB at boot → 1.9 GB after ~8 h), not import weight | **Shipped** (lazy `add_handlers` import) |
| 6 | Fix the RPC churn the audit found (F1: `execution reverted` opened circuits; dead endpoints retried forever) | Verified in code | CPU 0.26 vCPU avg ≈ $5/mo; both memory incidents were preceded by wallet RPC timeout bursts | Partly done upstream (`rpc_manager.py` now refuses to select an all-open chain and ignores reverts); Starknet `rpc.starknet.lava.build` returns 410 on every call — replace the endpoint |
| 7 | Move genuinely periodic loops to Railway cron services | Documented (docs.railway.com/reference/cron-jobs, 5-min minimum) | A cron service bills only while running; 20 always-on loops at 2 GB is the structural cost | **Not done** — architecture change; candidates are `digest_service`, `execution_scorer`, `withdraw_reconciler`, `balance_refresher` |
| 8 | Account-level usage limit (soft email / hard stop) | Documented (docs.railway.com/reference/usage-limits) | Second safety net for runaway spend | Dashboard setting — set it |
| 9 | Delete/scale-to-zero the dev-env long tail (audit F4/F5) | Measured | ~$15–20/mo of idle dev services | Not this change |

## What the next incident will tell us

When RSS crosses 3 GB the worker logs, once per minute until it recovers or
is restarted:

```
Memory guard above soft limit for 60s: rss=3.41GB
rss=3.41GB cgroup=3.52GB gc_objects=1893211 tracemalloc=on
tasks: BalanceRefresher._refresh_one=412, TxPoller._poll_loop=1, ...
types: dict=612330, list=201188, tuple=180002, ...
alloc since soft-limit:
   812.4 MB     9123 blocks  client_reqrep.py:1140 <- wallet.py:1531 <- balance_refresher.py:240
```

Read `tasks:` first (which loop has hundreds of live coroutines?), then the
`alloc since soft-limit` frames (what is it allocating?). Fix that loop; do
not raise `MEMORY_GUARD_SOFT_GB` to silence it. `/health/ready` on
`python-api` also exposes `checks.memory.peak_gb`, which tells you whether a
balloon already happened since the last restart even if you missed the logs.

## Tuning knobs

| Env var | Default | Notes |
|---------|---------|-------|
| `MEMORY_GUARD_ENABLED` | `true` | Runs on both `python-api` and `python-worker` (same entrypoint) |
| `MEMORY_GUARD_SOFT_GB` | `3.0` | Normal worker max observed: 2.03 GB |
| `MEMORY_GUARD_HARD_GB` | `6.0` | Must stay below the Railway `memoryBytes` limit (8 GiB) so *our* exit — with its report — wins the race |
| `MEMORY_GUARD_HARD_ACTION` | `exit` | `log` = observability only |
| `MEMORY_GUARD_INTERVAL_SECONDS` | `15` | |

## Sources

- Railway — Right-size CPU and memory from real metrics: https://docs.railway.com/guides/right-size-cpu-memory
- Railway — Cost control (limits cap, don't reduce): https://docs.railway.com/pricing/cost-control
- Railway — Usage limits: https://docs.railway.com/reference/usage-limits
- Railway — App sleeping: https://docs.railway.com/reference/app-sleeping
- Railway — Cron jobs: https://docs.railway.com/reference/cron-jobs
- Railway — Config as code (deprecated 2026-12-01; `limitOverride` is in the JSON schema, not the page): https://docs.railway.com/config-as-code · schema: https://backboard.railway.app/railway.schema.json
- Railway Station — programmatically setting memory/vCPU: https://station.railway.com/questions/programmatically-setting-instance-memory-016d6ad4
- Railway Station — OOM exits 137 / crash-loop billing: https://station.railway.com/questions/out-of-memory-bfbf5643
- Heroku — Tuning glibc memory behavior (`MALLOC_ARENA_MAX`): https://devcenter.heroku.com/articles/tuning-glibc-memory-behavior
- glibc fragmentation write-up: https://blog.arkey.fr/drafts/2021/01/22/native-memory-fragmentation-with-glibc/
- jemalloc vs glibc RSS case study (47 % cut): https://www.refine.ink/blog/jemalloc-fragmentation
