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
| 1 | **Lower `MEMORY_GUARD_SOFT_GB` to ~1.0** so the guard's allocation report fires across the climb | Yes — nothing else names what the working set is made of | Our code; the report had never fired because the limit sat above the plateau | **XS** | **Done** — set in production 2026-09-14, armed by the 09-19 deploy. Read it before shipping anything below. |
| — | ~~Scheduled process recycle~~ | — | **Overturned by money-path review — do not ship.** See the recycle section. | — | Unsafe at 8 h and 4 h; ~$2.5/mo at the only defensible cadence |
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

### Status after money-path review: DO NOT SHIP

An independent adversarial review overturned most of the risk audit above. The
scheduled recycle is **not** safe to ship today at any cadence, and the risk
audit's own blocking item turned out to be the wrong one.

**What the research pass got wrong:**

- `fee_service.sweep_all_fees()` **moves no funds.** It is pure ledger
  reconciliation — one `UPDATE ... SET collected=True WHERE ... collected=False`
  per batch, each in its own transaction. Partial execution is harmless because
  the next pass picks up exactly the remainder. It is naturally idempotent. The
  alleged blocker does not exist.
- The real fund movement is in the **caller**, which the research missed:
  `fee_sweeper` derives the protocol's share from an **in-memory** list *after*
  the ledger is already marked collected, then deposits to the treasury vault.
  A kill in that gap loses the tranche permanently, because nothing can
  re-derive it once the rows read `collected=True`.
- "The nonce is persisted before broadcast" holds for **exactly one** of about
  twenty executors. The rest persist nothing before broadcast.

**The escalation that changes the verdict.** A swap that broadcast successfully
but died before its transaction hash was written is not merely mislabelled. The
row is terminal: both the transaction poller and the execution reconciler filter
on a non-null transaction hash, so nothing ever revisits it. The reconciliation
that flips it to `FAILED` runs only at startup, never on a timer — so the
restart that *caused* the orphan leaves it alone (it is seconds old, under the
10-minute cutoff) and the **next** restart flips it. A scheduled recycle
therefore converts an intermittent bug into a reliable one.

And `FAILED` is explicitly treated as **not** a duplicate by the swap
idempotency guard, while the order service builds **hour-bucketed** retry keys.
If a false `FAILED` flip and a retry land in the same hour bucket, the same swap
**re-broadcasts with the user's funds.** That needs two restarts inside one hour
— which is exactly what a recycle followed by a deploy produces.

**The worst target, which nobody had looked at:** the CCTP relayer broadcasts,
then waits on a receipt with a 180-second timeout, then writes status — twice
per deposit. That is an exposed window of up to about six minutes per deposit
with **no persisted intent**. A kill in the mint window replays a consumed Circle
nonce; a kill in the credit window ends with the deposit marked `failed` even
though the funds arrived, and the user is never notified. Its attempt counter is
permanent, so repeated recycles erode it cumulatively toward failure.

**Why "it already dies every two days" does not license this.** That is roughly
15 kills a month; an 8-hour recycle is about 90 and a 4-hour one about 180. More
decisively, every failure mode above is **silent by construction** — a false
`FAILED` swap and a wrongly-failed deposit both look like a plausible "it
failed" to the user. Absence of complaints is close to zero evidence of absence
of harm.

**Conditions that would make it safe,** in priority order: a drain flag with a
bounded grace period so the *voluntary* exit defers while fund-moving work is in
flight, while the OOM exit keeps firing immediately; a distinct non-retryable
status for orphaned swaps so the double-spend path closes; persisted intent
before every CCTP broadcast; reordering the fee sweeper so the vault tranche
stays re-derivable; and confirming in the deployed environment that the CCTP
relayers and the Aave vault path are actually disabled.

**Cadence verdict:** no scheduled recycle today. With a drain flag, the
orphan-status fix, and the env check confirmed, 24 hours would be defensible —
which models to only about a 12 % RAM cut (~$2.5/mo). Most of the headline
saving lives at the cadences that are unsafe. 4 hours is not worth 180 scheduled
interruptions a month against fund-moving loops whose failures are invisible.

**The better first move is the diagnostic.** The worker climbs from 0.20 GB to
2.34 GB — that is a leak, and finding it captures the full saving with none of
this risk. The guard already arms `tracemalloc` at its soft limit, but that limit
is 3.0 GB and the worker never reaches it, so the report has **never once
fired.** Lowering `MEMORY_GUARD_SOFT_GB` to about 1.0 arms the report across the
whole climb.

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

## What five days of uptime actually showed (2026-09-19)

The worker ran **five days without a restart**. Its own heartbeat over that
window:

```
Memory guard: rss=1.75GB cgroup=2.00GB peak=1.93GB
Memory guard: rss=1.87GB cgroup=2.11GB peak=1.93GB
Memory guard: rss=1.76GB cgroup=2.01GB peak=1.93GB
```

RSS oscillated between 1.75 and 1.87 GB and **peaked at 1.93 GB across the
entire five days.** No balloon, no crash, no unbounded growth.

This reframes the problem, and it contradicts the working assumption that has
driven this whole investigation:

- **There is no runaway leak left to find.** The curve is a climb to a
  steady-state working set that then holds. Calling it a leak was wrong.
- **The 27.5 GB balloons have stopped.** The last one predates the guard. What
  remains is an ordinary, stable ~1.9 GB resident footprint.
- **The remaining cost is therefore a working-set problem, not a bug.** The
  levers that can move it are the allocator, cache sizing and TTLs, and the
  breadth of the RPC fan-out — not leak-hunting.

The guard's soft limit was never reached because the worker never got near
3.0 GB. `MEMORY_GUARD_SOFT_GB` is now set to 1.0 so the allocation report arms
across the climb and names what makes up the working set. **That report is the
next piece of evidence; nothing below it should be shipped before reading it.**

Note also that the guard's INFO heartbeats are being recorded at `error`
severity in Railway's log stream, which makes real errors harder to find.

## Area 4 — aiohttp and httpx

**Already correct in this repo.** Verified, and listed so nobody re-does it: a
single shared `aiohttp.ClientSession` behind a lock, with a `TCPConnector` set
to `limit=200`, `limit_per_host=50`, `ttl_dns_cache=600`,
`keepalive_timeout=120`, `enable_cleanup_closed=True`, `force_close=False`.
That is the textbook configuration for a long-running fan-out worker. web3.py's
`HTTPProvider` is likewise instantiated once per chain and cached, not per call.

| Open item | Mechanism | Verified? | Effort | Expected effect |
|---|---|---|---|---|
| Audit for call sites that bypass the shared `fetch_json` helper | A bare `await session.get(...)` without `async with` or an explicit release leaves the response body buffered — the classic aiohttp leak | The shared helper uses the context-manager form correctly. **Not verified that every direct call site elsewhere does.** | S | Unknown until audited; worth a grep given the working set is now the target |
| `read_bufsize` tuning | Larger buffers cut syscalls on big responses, but cost RSS per in-flight connection | Documented aiohttp parameter, currently at its default | S | Likely negligible — these are small balance reads, not large log queries |
| `max_field_size` / `max_line_size` | Caps header parsing buffers | Documented; defaults already generous | S | Negligible, no evidence of oversized headers here |

Informational: web3.py issue #3789 keys sessions by thread identity even when an
explicit session is passed, so a shared session is silently ignored outside the
creating thread. **Not applicable** to this codebase's one-provider-per-chain
pattern, but it would bite if that pattern ever changed.

## Area 5 — web3.py

| Item | Mechanism | Verified? | Effort | Expected effect |
|---|---|---|---|---|
| **Build the ABI encoders once instead of per call** | `w3.eth.contract()` parses the ABI and builds the function namespace and codec every time. It was being paid three times per multicall, plus a keccak checksum per token. | Our code | S | **Shipped** — see the multicall change; output verified byte-identical |
| `Web3` instance reuse | web3.py recommends one provider per URL per process so TCP connections are recycled | Already done | Done | — |
| ABI and codec caches | `eth_abi`'s registry caches by type string internally and is not something this codebase steers; the controllable cost was repeated `.contract()` calls | Mechanism only | — | Addressed by the row above |
| Version-specific leaks | No report found for the pinned version | **Unverified** — needs a changelog check against the exact pin | S | Unknown; a follow-up, not a finding |

## Area 6 — SQLAlchemy

Current configuration: `pool_pre_ping=True`, `pool_size=15`, `max_overflow=25`,
`pool_recycle=3600`, dispatched through a 24-thread executor.

| Item | Mechanism | Verified? | Effort | Expected effect |
|---|---|---|---|---|
| Up to 40 connections provisioned, but only 24 executor threads can hold one concurrently | Each pooled connection carries a small resident cost, so up to 16 are headroom that is rarely exercised | **Not verified as wasteful.** Plausible over-provisioning, not a confirmed one. Under-provisioning causes worse problems, so measure pool status under real load first. | S to measure | Unknown, likely small — do not cut blind |
| `expire_on_commit` | Defaults to `True`, which prevents identity-map objects accumulating stale state across a long-lived session | **Not verified** whether anything overrides it to `False` | S to check | No action if default; a real growth risk if overridden anywhere |
| Session leaks from executor threads | A session opened in an executor-dispatched function and not closed in a `finally` leaks a pooled connection and its identity map per call | **Not audited.** The dispatcher wraps an arbitrary callable, so leak-safety rests entirely on each caller. | M | This is exactly the shape that produces a climbing-then-plateauing working set. Check the guard's type histogram for session and connection types when the report arms. |
| `yield_per` streaming | Avoids materializing a large result set and its identity-map entries | Documented, but **no query here looks large enough to need it** — the loops query small filtered sets | S if a hot spot appears | Not a blind recommendation |

## Area 7 — asyncio

| Item | Mechanism | Verified? | Effort | Expected effect |
|---|---|---|---|---|
| Extend the balance refresher's supervisor pattern to the other loops | Its supervisor never awaits the pass directly — that is what caused three past incidents — and instead cancels with a grace period and tracks abandoned passes so they are never silent | Our code, pattern already proven here | M | Prevents the next incident class. Whether the other loops use `wait_for` internally was **not individually audited**; that audit is the real next step. |
| Bare `create_task` with no retained reference | CPython does not guarantee a pending task survives if nothing holds a strong reference — it can be collected mid-execution | Documented CPython behavior | M to audit | **Not verified across the services here.** A grep for `create_task(` without an assignment would find candidates. |
| Unbounded `asyncio.Queue` | A queue between a fast producer and slow consumer accumulates under load | Standard pattern; **no unbounded queue confirmed here** | S to audit | Unknown until audited |
| `loop.slow_callback_duration = 0.1` | Logs any callback blocking the loop over 100 ms, naming the coroutine. Do **not** use the asyncio debug env var instead — it changes scheduling. | Verified stdlib feature | S | Diagnostic, not a direct cut, but cheap |
| Timeout-cancelled tasks holding response buffers | A cancelled inner task does not always release an in-flight response promptly if it handles cancellation lazily | Documented interaction. The refresher fix was this exact bug class, found and fixed once here already — reasonable evidence it can recur. | M | Same audit as row 1 |

## Area 8 — Docker and runtime

**Already well built**, confirmed by reading the Dockerfile. Capped at the
0.28 GB floor regardless, per the isolating datum.

- Multi-stage: the compiler toolchain stays in the builder; the runtime stage
  carries only the Postgres client library and curl.
- `PIP_NO_CACHE_DIR` and `PYTHONDONTWRITEBYTECODE` both set.
- Base is the slim Debian image, not the full one.
- A single uvicorn process with no multi-worker flag, which is correct for a
  process whose caches and task supervision are not safe to duplicate.
- uvloop installed at import before any loop is created, so it is already the
  fast path.

| Open item | Verdict |
|---|---|
| `--no-access-log` | Negligible here — the worker takes healthchecks only, no user traffic |
| Alpine base | **Do not.** musl's allocator handles fragmentation worse than glibc, and several pinned native dependencies ship no musl wheels, forcing slow source builds. |
| Removing `--reload` | Already absent from the production command |

## Area 9 — Railway levers

Verified directly from the service configuration rather than from docs:

- **Build watch patterns are already set** on the worker, scoped to the Python
  and config paths. This is the lever that stops unrelated pushes triggering a
  rebuild, and it is already doing its job.
- **One replica, single region.** No replica sprawl to trim.
- **IPv6 egress disabled.**

| Lever | Status |
|---|---|
| Account usage limits (soft email, hard stop) | Documented Railway feature. **Still not set** — a dashboard action, and the cheapest possible insurance against a runaway invoice. |
| Limits cap the worst case but do not lower the bill | Railway says so explicitly. Set them for safety, not savings. |
| App sleeping | **Does not apply.** Sleep triggers on outbound inactivity; a polling worker never goes quiet, and with no inbound HTTP nothing would wake it. |
| Private networking | Avoids egress charges between services. Worth confirming the worker reaches Postgres and Redis over the internal hostnames rather than public ones. |
| Region choice | Not a price lever — no regional compute price differences are documented. |
| Cron services | Minimum interval is 5 minutes, too coarse for a 60-second refresh, and a small always-on worker still bills. Not a win. |
| A second smaller service | Not cheaper. Two services both bill their own baseline. |

## Area 10 — Free profiling

All free and open source. The point of this section is that the guard's
soft-limit branch is the natural hook, and it now actually fires.

| Tool | What it gives | Caveat |
|---|---|---|
| `tracemalloc` (stdlib) | Allocation sites with call frames | Already wired into the guard. Roughly doubles allocation cost while armed, so it belongs behind a threshold, not on always. |
| `py-spy dump` | A stack sample of every thread from **outside** the process, at near-zero overhead — the fastest way to catch a synchronous call starving the loop | Needs `ptrace`. **Whether Railway's container permits it is unverified** — test before relying on it. |
| `memray attach` | Real allocation sites with under 5 % overhead | Same ptrace question |
| `objgraph` / `pympler` | Reference chains showing what keeps an object alive | Expensive; use only once a suspect type is known |
| `/proc/self/smaps_rollup` | The cheapest possible RSS and PSS read | Already the mechanism behind the guard's sampling |
| `gc` type histogram | Which container types dominate | Already in the guard's report, but it walks every object, so it must stay behind a threshold |

## Area 11 — Free RPC and data levers

| Lever | Mechanism | Status |
|---|---|---|
| **Multicall3 `aggregate3`** | One `eth_call` per chain instead of one per token | **Already implemented.** Deployed at the same address on 100+ chains, with per-call failure allowed so one bad token cannot fail the batch. |
| **Batch multiple wallets into one aggregate3** | Currently one batched call *per wallet* per chain; the calls for many wallets could ride in a single aggregate3 | **Not done.** The largest remaining free RPC win, and it scales with wallet count. MONEY-PATH-adjacent — balances feed swap and withdrawal decisions. |
| JSON-RPC batch requests | Several distinct methods in one HTTP round trip | Complementary to multicall, and useful for the non-EVM chains that have no multicall equivalent |
| Blockscout | Free explorer API, no key, broad chain coverage | Already available in this environment as a tooling integration |
| Free public endpoints | publicnode and similar | Already wired in as fallbacks, with per-endpoint cooldowns after the Starknet outage |
| Cache with TTL plus refresh-on-read | Refresh only what someone is actually looking at | **Not done.** Now the highest-value structural change, since the target is a steady-state working set rather than a leak. |

## Does not help — cargo cult

Listed so nobody spends a cycle on them.

- **`PYTHONMALLOC=malloc`** — likely *negative*. pymalloc's arena pooling exists
  precisely for the many small dicts, tuples and lists a wide RPC fan-out
  creates. Removing it would probably increase fragmentation.
- **`-X no_debug_ranges`** — no evidence it affects RSS. It changes bytecode
  debug metadata, not the runtime heap.
- **`-OO` / `PYTHONOPTIMIZE=2`** — strips docstrings and asserts for probably
  under 10 MB, while silently disabling every `assert`-based invariant check.
  The risk outweighs the gain.
- **Alpine base image** — worse allocator behavior and missing native wheels.
- **`gc.freeze()` sold as a copy-on-write win** — that benefit is fork-specific.
  This worker is a single process with no fork boundary. The smaller scan-cost
  benefit is real; the headline one does not apply.
- **`PYTHONHASHSEED`** — irrelevant to memory and CPU.
- **Region shopping** — no documented regional compute price differences.
- **Replica or resource limits as a saving** — Railway states plainly that they
  cap the worst case and do not lower the bill.
- **Treating the plateau as a leak** — five days of flat 1.9 GB says it is a
  working set. Leak-hunting tools will keep coming back empty.

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
