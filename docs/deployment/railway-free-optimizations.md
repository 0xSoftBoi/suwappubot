# Railway free-only optimizations — python-worker

Companion to [`railway-cost-playbook.md`](railway-cost-playbook.md) (what's
shipped) and [`railway-cost-audit.md`](railway-cost-audit.md) (the original
measurements). This doc covers what those two did **not**: a wide,
zero-cost-only sweep across allocator, GC, interpreter, library, Docker,
Railway, profiling and RPC levers, evaluated against this specific codebase
rather than as generic advice. Researched 2026-09-13/14.

**Hard filter respected throughout: every item below is free** — open-source
packages, env vars, code changes, or free-tier/already-paid-for services only.
Anything that only pays off on a paid plan or paid API tier was excluded
entirely, not listed with a caveat.

> Money-path claims in the recycle section carry verified file:line references
> from a read-only research pass. An independent `money-path-reviewer` audit of
> those specific claims was commissioned; see **Status** at the end of that
> section before acting on them.

## The isolating datum (read this before the ranked table)

`python-api` and `python-worker` run the **same image and entrypoint**,
differing only by `ENABLE_BACKGROUND_SERVICES` / `RUN_TELEGRAM_BOT`
(`bot/config/settings.py:41-49`). Measured from the Railway control plane over
the same 24 h window on 2026-09-14:

| | avg RSS | min | max | avg vCPU |
|---|---:|---:|---:|---:|
| `python-api` (no background loops) | 0.282 GB | 0.174 | 0.407 | 0.007 |
| `python-worker` (background loops) | 1.957 GB | 0.158 | 2.341 | 0.242 |

`python-worker`, 7-day window: RSS avg 1.941 GB, max 27.53 GB; CPU avg 0.270
vCPU; network TX avg 0.0041 GB.

**The entire ~1.7 GB delta is attributable to the background service loops —
not to imports, the framework, uvicorn, or the base image.** This is the single
most important fact in this document. It means **interpreter flags (area 3) and
Docker/image-level changes (area 8) can only ever touch the 0.28 GB shared
floor**, not the 1.7 GB that is actually costing money. They are ranked
accordingly below: real, but capped, and demoted under anything that touches the
loop layer — allocator behavior under churn, GC scan cost under churn, the
loops' own RPC and object-creation patterns, and process recycling, which resets
the whole curve regardless of root cause.

At $10/GB-RAM-month the worker's RAM line is ~$19.6/mo and CPU ~$5.4/mo. Railway
bills the per-minute **average**, so the flat 1.96 GB plateau is the bill; the
27.5 GB spike lasting minutes costs cents.

## Top 10 (ranked, all $0)

| # | Recommendation | Targets the 1.7 GB delta? | Verified? | Effort | Expected effect |
|---|---|:-:|---|---|---|
| 1 | **Scheduled process recycle** (8 h to start) reusing `memory_guard`'s `os._exit(137)` + `ON_FAILURE` restart | Yes — resets the whole curve regardless of cause | Measured/modeled from the real prod curve | S–M | ≈$5.8/mo (30 %) at 8 h, ≈$10/mo (51 %) at 4 h — **MONEY-PATH gated** |
| 2 | Cache `w3.eth.contract()` objects instead of rebuilding them on every call | Yes — hot loop, every wallet × chain × 60 s | Our code | S | CPU cut on the hottest loop; RSS unknown, needs A/B |
| 3 | Batch wallets into **one** Multicall3 `aggregate3` per chain per pass, not one call per wallet | Yes — cuts `eth_call` volume roughly N-wallets-fold | Our code + Multicall3 docs | M | Collapses RPC volume on the dominant loop; MONEY-PATH-adjacent |
| 4 | jemalloc via `LD_PRELOAD` with explicit `MALLOC_CONF` | Yes — fragmentation tracks allocation churn, which is entirely in the loops | External case studies; **unverified for this workload** | S | Possibly $5–10/mo; A/B one replica first |
| 5 | `gc.freeze()` after boot, before the loops start | Yes — fewer objects scanned per collection | Mechanism verified; effect size for a non-forking process unproven | S | Unknown, needs A/B; CPU-focused, not primarily RSS |
| 6 | `gc.set_threshold()` raised from the default `700,10,10` | Yes | Verified pattern; not measured in this repo | S | Lowers vCPU-minutes; may raise RSS slightly — track both |
| 7 | Wire `py-spy dump` + `memray attach` into the guard's soft-limit branch | Diagnostic — fastest path to finding what in the delta is fixable | Free tools (MIT / Apache-2.0); Railway ptrace permission **unverified** | S | Turns the next incident into a named line of code |
| 8 | Extend the balance refresher's supervisor task pattern to the other background loops | Yes — the loop layer is 100 % of the delta | Our code; pattern already proven in this repo | M | Prevents the next incident class |
| 9 | Interpreter flags (`-OO`, `__slots__`, `sys.intern`) | **No — capped at the 0.28 GB floor** | Mixed, see area 3 | S | Sub-1 % of the worker's bill; do last, if at all |
| 10 | Further Docker image slimming | **No — capped at the floor** | Image is already multi-stage slim | — | ~$0 remaining headroom |

## Scheduled process recycle (full analysis)

Post-restart curve: 0.20 GB → ~1.0 GB at 2 h → plateau ~2.3 GB. It never comes
back down on its own.

Fitted saturating exponential `RSS(t) = P − (P−R0)·e^(−t/τ)`, P = 2.3, R0 = 0.2.
Solving at t = 2 h: `1.0 = 2.3 − 2.1·e^(−2/τ)` → `e^(−2/τ) = 0.619` → **τ ≈ 4.17 h**.
Cross-check against the playbook's independent earlier observation (0.44 GB at
boot → 1.9 GB after ~8 h): the model gives RSS(8 h) ≈ 1.99 GB. Consistent.

Time-averaged RSS over a recycle period T is
`avg(T) = P − (P−R0)·(τ/T)·(1 − e^(−T/τ))`:

| Interval | Modeled avg RSS | RAM $/mo | Saved vs. $19.5/mo |
|---|---:|---:|---:|
| None (current) | 1.95 GB (measured) | $19.5 | — |
| 4 h | 0.95 GB | $9.5 | ≈ $10.0 (51 %) |
| **8 h (recommended start)** | 1.37 GB | $13.7 | ≈ $5.8 (30 %) |
| 12 h | 1.61 GB | $16.1 | ≈ $3.4 (17 %) |

**This is not a novel hack.** It is the standard mitigation for exactly this
fragmentation-plateau shape, and every major Python server ships it:

- gunicorn `--max-requests` / `--max-requests-jitter`, where jitter staggers
  restarts so they don't all fire at once — https://gunicorn.org/reference/settings/
- uWSGI `reload-on-rss` / `evil-reload-on-rss`, an RSS-**threshold**-triggered
  recycle — the same mechanism, built into the app server —
  https://uwsgi-docs.readthedocs.io/en/latest/Options.html
- Celery `worker_max_memory_per_child` —
  https://docs.celeryq.dev/en/stable/userguide/optimizing.html
- Instagram treats scheduled/adaptive recycling as routine for this shape —
  https://instagram-engineering.com/adaptive-process-and-memory-management-for-python-web-servers-15b0c410a043

Effort is **S**: the killing half already exists and is proven in production
(`bot/services/memory_guard.py`). Only the scheduled trigger is missing.

### MONEY-PATH risk audit

Services started in `api/main.py`'s lifespan:

- **`swap_engine`** — the nonce is persisted *before* broadcast specifically so
  it survives a process death (`bot/services/swap_engine.py:4457-4485`). Startup
  reconciles orphaned `EXECUTING`-with-no-`tx_hash` rows after a 10-minute
  cutoff, marking them `FAILED` (`api/main.py:203-222`). **Alleged gap**: a swap
  that broadcast successfully but died before the `tx_hash` write would be
  falsely marked `FAILED` — a status lie, not a double-spend, but user-facing.
- **`fee_sweeper`** (`bot/services/fee_sweeper.py:47-130`) —
  `SWEEP_TIMEOUT_SECONDS=180` bounds the call, but **no CAS or idempotency guard
  was found** in `_do_sweep`. Whether a mid-sweep kill double-sweeps or
  under-sweeps is unverified. **This is the blocking item.**
- **`withdraw_reconciler`** (`bot/services/withdraw_reconciler.py:98-196`) —
  explicit CAS `PENDING→COMPLETED`, safe to interrupt and re-run. The reference
  pattern the other two should be measured against.
- **`tx_poller`, `order_service`, `health_monitor`, `launch_detector`,
  `balance_refresher`** — observation and polling loops with no unique in-flight
  state. The balance refresher already uses abandon-don't-await task supervision.

### Implementation constraint

`railway.python-worker.json` sets `restartPolicyType: ON_FAILURE`, so a clean
exit code 0 would **not** restart — it would take the worker down permanently.
A graceful scheduled drain therefore needs either `restartPolicyType: ALWAYS` or
a non-zero exit after draining. Reusing the existing hard `os._exit(137)` path
sidesteps that but inherits an ungraceful kill's risk profile.

Boot cost does not cancel the saving: the ~30 s restart is billed at near-zero
RSS while the process is gone, and the refresher's warmup burst is a few seconds
of CPU a handful of times a day against a $3.4–$10/mo saving.

### Status

**Do not enable a recycle yet.** The `fee_sweeper` idempotency question above is
open and is being audited independently. The recommended starting interval is
**8 h**, not 4 h: it captures about two thirds of the attainable saving at half
the restart frequency and half the exposure.

The worker has already been dying abruptly in production roughly every two days
with no reported fund loss, which is evidence this class of interruption is
survivable — but it is **not** proof any specific sweep is safe at an 8 h
cadence, because none of those incidents is confirmed to have landed mid-sweep.

## Area 1 — Allocator

| Change | Mechanism | Verified? | Effort | Expected effect |
|---|---|---|---|---|
| `LD_PRELOAD=/usr/lib/x86_64-linux-gnu/libjemalloc.so.2` plus `MALLOC_CONF=background_thread:true,dirty_decay_ms:1000,muzzy_decay_ms:1000,narenas:2` in `api/Dockerfile.railway` | jemalloc purges freed pages back to the OS on a background thread. glibc, even with the already-shipped `MALLOC_ARENA_MAX=2`, retains freed memory inside arenas. `MALLOC_ARENA_MAX` caps arena *count*, not fragmentation *within* an arena. | External: a 47 % RSS cut in production, a 5.7× steady-state difference in a controlled benchmark, and a FastAPI-specific writeup. **Unverified for this workload** — A/B one replica over 8 h+ before rollout. | S | Should help the 1.7 GB delta, since fragmentation tracks the loops' churn, but the magnitude here is genuinely unknown |
| tcmalloc instead of jemalloc | Similar purge-to-OS behavior via `TCMALLOC_RELEASE_RATE` | Less benchmarked for Python asyncio workloads than jemalloc; no strong evidence either way | S | Lower priority — pick one, and jemalloc has more direct evidence |
| `PYTHONMALLOC=malloc` | pymalloc only handles allocations ≤512 bytes; larger ones already go to the system allocator. Disabling it removes Python's small-object pooling. | Mechanism verified against CPython docs, but **no evidence it helps here**. It would likely *increase* fragmentation for the many small dict/tuple/list objects a 40-chain fan-out creates, which is exactly what pymalloc's arena-based handling exists for. | S | Likely **negative**. Listed because it was asked about, not recommended. |

## Area 2 — GC

| Change | Mechanism | Verified? | Effort | Expected effect |
|---|---|---|---|---|
| `gc.freeze()` once at the end of lifespan startup, after imports and caches settle, before the background loops start | Moves every object alive at that point into a permanent generation the collector never scans again. In a **non-forking single process** — which this worker is — the benefit is purely fewer objects scanned per collection, not copy-on-write sharing. That COW benefit is fork-specific and does not apply here. | Mechanism verified against the CPython docs. Note that Instagram's headline win is the fork-specific one; the scan-cost win is a real but smaller side effect that does apply. | S | Unknown magnitude for this process shape. Free and directionally correct given the loops allocate constantly. Needs A/B. |
| `gc.set_threshold(50000, 50, 50)`, raised from the default `700,10,10` | High-allocation-rate asyncio code — a Task, Future and coroutine per RPC call, across many chains, every 60 s — trips gen-0 collection constantly under the default. Raising it trades slightly more transient RSS for less GC CPU. | Verified pattern with production reports; not yet measured in this repo | S | Lowers vCPU-minutes, part of the $5.4/mo CPU line. May raise RSS slightly — measure both, don't ship blind. |
| Scheduled `gc.collect(2)` instead of relying on automatic generational triggers | Full-generation collections are expensive; running them at a known-idle moment can smooth CPU spikes | Lore-adjacent. Plausible mechanism, no source found quantifying it for asyncio workloads. | M | Unknown, needs A/B. Lower priority than the two above. |
| Freezing before forking | **Not applicable.** `python-worker` is a single process; uvicorn is not run multi-worker here. There is no fork boundary to exploit. | N/A | — | Do not implement |

## Area 3 — Interpreter flags

Per the isolating datum, **none of these can touch the 1.7 GB delta.** The
0.28 GB `python-api` baseline already reflects whatever the interpreter and
import layer cost, and these flags only affect that shared floor. Do them last,
if at all.

| Change | Mechanism | Verified? | Effort | Honest size |
|---|---|---|---|---|
| `-OO` / `PYTHONOPTIMIZE=2` | Strips docstrings and `assert` statements from bytecode | The effect is real but well under 1 % of heap for a codebase this size. It also silently disables any `assert`-based invariant check. | S | **Negligible, likely <10 MB**, and the disabled-assert risk may outweigh it |
| `-X no_debug_ranges` | Reduces bytecode debug metadata for column-precision tracebacks | No source found substantiating an RSS claim. It affects `.pyc` debug info size, not runtime heap. | — | **No evidence it affects RSS at all** |
| `PYTHONDONTWRITEBYTECODE=1` | Skips writing `.pyc` files | Already set in `api/Dockerfile.railway` | Done | Saves disk I/O and a few MB of disk, not RSS |
| `sys.intern()` on hot strings | CPython already auto-interns most identifier-shaped literals. Manual interning only helps for large sets of *dynamically constructed* duplicate strings. | Mechanism verified, but it only helps if profiling shows string duplication among the top allocators. Do not apply speculatively. | S if targeted | Unknown until profiled; likely small even then |
| `__slots__` on hot DTOs | Saves roughly 40–50 bytes per instance versus a `__dict__`-backed one; only matters at tens of thousands of live instances | Mechanism verified. Whether this codebase has that instance count is **unverified** — check the guard's type histogram first. | S per class | Small unless a specific DTO shows up as a top type |
| `PYTHONHASHSEED` | Security and determinism only | Confirmed irrelevant to memory and CPU | — | None |

<!-- Areas 5-11, the cargo-cult section and Sources are appended as they are
     verified. Sections are written incrementally so an interrupted research
     run costs a section, not the document. -->

## Sources

- Railway — right-size CPU and memory: https://docs.railway.com/guides/right-size-cpu-memory
- Railway — cost control: https://docs.railway.com/pricing/cost-control
- Railway — usage limits: https://docs.railway.com/reference/usage-limits
- gunicorn settings: https://gunicorn.org/reference/settings/
- uWSGI options (`reload-on-rss`): https://uwsgi-docs.readthedocs.io/en/latest/Options.html
- Celery optimizing: https://docs.celeryq.dev/en/stable/userguide/optimizing.html
- Instagram Engineering — adaptive process and memory management: https://instagram-engineering.com/adaptive-process-and-memory-management-for-python-web-servers-15b0c410a043
- Instagram Engineering — copy-on-write friendly Python GC: https://instagram-engineering.com/copy-on-write-friendly-python-garbage-collection-ad6ed5233ddf
- jemalloc fragmentation case study: https://www.refine.ink/blog/jemalloc-fragmentation
- BetterUp — chasing a memory leak in an async FastAPI service, fixed with jemalloc: https://build.betterup.com/chasing-a-memory-leak-in-our-async-fastapi-service-how-jemalloc-fixed-our-rss-creep/
- CPython memory management: https://docs.python.org/3/c-api/memory.html
- CPython `gc` module: https://docs.python.org/3/library/gc.html
