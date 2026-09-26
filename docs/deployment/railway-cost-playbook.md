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

## Next level (researched 2026-09-13, after six days on the guard)

Six days after the guard shipped: zero crashes, worker RSS 1.66–2.37 GB. The guard
is a safety net, not a root cause fix. Ranked by expected $ and reliability impact:

| # | Recommendation | Why it beats what we have | Effort | Expected effect |
|---|---|---|---|---|
| 1 | **Gate the balance refresher to active wallets.** `balance_refresher._refresh_all` refreshes *every* active wallet × ~40 EVM chains + Solana/Tron/Starknet every 60 s. Refresh only wallets with a Redis "seen in last N min" marker (set by handlers on interaction); exponential backoff per wallet on RPC failure; cache-with-TTL + refresh-on-read for the rest. | It is the plausible root cause of both the RSS plateau (thousands of aiohttp/web3 objects churned per pass → allocator fragmentation) and the RPC-timeout bursts that preceded every balloon. | M | 80–95 % fewer RPC calls/min; removes the 429 storms; lowers billed CPU-minutes. MONEY-PATH-adjacent (balances feed swap/withdraw decisions) → `money-path-reviewer` before merge. |
| 2 | **Catch the next balloon with a real cause, not tracemalloc-after-the-fact.** Hook off the guard's soft-limit branch: `py-spy dump --pid` (out-of-process, near-zero overhead, shows the sync call starving the loop), `memray attach` for a few minutes (< 5 % overhead, real allocation sites), and `loop.slow_callback_duration = 0.1` at startup (logs the coroutine that stalls the loop; do **not** use `PYTHONASYNCIODEBUG`, it changes scheduling). | tracemalloc armed at 3 GB misses the first 3 GB of climb and doubles allocation cost exactly when the process is already stressed. | S/M | Turns the next incident into a named line of code. |
| 3 | **Alchemy Portfolio API for EVM balances** instead of 40-chain RPC fan-out; one request per wallet. | Alchemy pitches it as "one request instead of parallelizing dozens of calls across networks". | M | Collapses the fan-out; pilot on one chain set first. |
| 4 | **jemalloc via `LD_PRELOAD`** in `api/Dockerfile.railway` (`libjemalloc2`, `background_thread:true`). | `MALLOC_ARENA_MAX=2` caps arena *count*, not fragmentation *within* an arena; the 0.15 → 2 GB-then-plateau curve is classic glibc fragmentation. Third-party reports: 10x RSS reduction / 47 % cut. **Unverified for this workload** — A/B one replica over 8 h before rollout. | S | Possibly 0.5–1 GB off the baseline (≈ $5–10/mo). |
| 5 | **Railway Monitor → Telegram admin alert at ~4 GB RSS** (between soft and hard). | A human sees the climb before the guard's `os._exit(137)`. | S | Cheap insurance. |
| 6 | Cron-service or second-worker split | **Not recommended.** Cron minimum is 5 min (too coarse for a 60 s refresh) and a small always-on worker still bills ~$10/mo; the win is #1, not relocating the loop. | L | ~0 |

**Alchemy Starknet 429 decoded**: free tier is a token bucket at 300 CU/s (10 s rolling
window, 3000 CU burst), not a monthly quota. Constant 429s mean the per-60-s-per-wallet
Starknet calls exceed 300 CU/s sustained; #1 fixes this without a paid tier.

Do first: #1, then #2, then pilot #3; A/B #4; wire #5.

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
- Python allocator, glibc vs jemalloc: https://www.sakshamsharma.in/blogs/python-memory-allocator-glibc-vs-jemalloc/
- Alchemy Portfolio APIs: https://www.alchemy.com/docs/reference/portfolio-apis
- Alchemy throughput (CU/s token bucket): https://www.alchemy.com/docs/reference/throughput
- py-spy: https://github.com/benfred/py-spy · memray attach: https://bloomberg.github.io/memray/attach.html
- asyncio debug / slow callbacks: https://docs.python.org/3/library/asyncio-dev.html
- Railway webhooks / monitors: https://docs.railway.com/observability/webhooks · https://docs.railway.com/guides/alerts-crashes-failed-deploys
- Railway cron minimum interval: https://docs.railway.com/cron-jobs
