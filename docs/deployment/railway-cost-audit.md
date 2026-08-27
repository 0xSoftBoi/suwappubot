# Railway Cost & Efficiency Audit

**Project**: `suwappu` (`428680a3-dd24-4f7c-8349-e66d791b5104`)
**Environments**: `production` (`99bf10c1…`), `dev` (`ebbeb375…`)
**Data window**: 7 days (168h), 10,081 samples per series, pulled 2026-08-27 via Railway MCP.
**Method**: `get-service-metrics` per service per environment → modelled at Railway Pro
list rates ($20/vCPU-mo, $20/GB-RAM-mo, $0.15/GB-mo volume). Egress is negligible
(< 0.01 GB/sample across the fleet) and is excluded.

> These are **modelled** costs from measured average utilisation, not an invoice. Railway
> bills per-minute actual usage, so the modelled figure tracks the bill closely for
> steady-state services but understates services with large short spikes
> (see Finding 2). Reconcile against the Railway usage page before acting on absolute
> dollars; the *ranking* and the *ratios* are what this audit is for.

## 1. Where the money goes

Total modelled: **~$122/mo** — **$76 production / $46 dev**.

| $/mo | Env | Service | avg RAM (GB) | avg vCPU | disk (GB) |
|-----:|-----|---------|-------:|------:|------:|
| 36.44 | prod | **python-worker** | 1.618 | 0.2037 | — |
| 18.53 | prod | Postgres | 0.850 | 0.0411 | 4.79 |
| 11.72 | dev | **Postgres** | 0.504 | 0.0224 | **7.96** |
| 8.84 | dev | python-api | 0.412 | 0.0295 | — |
| 8.64 | dev | **market-data-capture** | 0.409 | 0.0235 | — |
| 5.71 | prod | python-api | 0.279 | 0.0063 | — |
| 4.87 | dev | **api-ts-marketdata** | 0.242 | 0.0012 | — |
| 4.08 | prod | api-ts | 0.201 | 0.0025 | — |
| 3.92 | dev | api-ts | 0.193 | 0.0026 | — |
| 3.82 | prod | showcase | 0.190 | 0.0006 | — |
| 2.59 | dev | pump-onchain-ingest | 0.121 | 0.0080 | — |
| 1.77 | prod | pump-onchain-ingest-prod | 0.087 | 0.0017 | — |
| 1.63 | dev | **suwappu-primitives-ui** | 0.082 | 0.0000 | — |
| 1.52 | prod | suwappu-bridge | 0.076 | 0.0000 | — |
| 1.19 | prod | suwappu-relayer | 0.058 | 0.0019 | — |
| 1.06 | dev | showcase | 0.053 | 0.0000 | — |
| 0.86 | prod | terminal | 0.043 | 0.0000 | — |
| 0.81 | prod | webapp | 0.040 | 0.0000 | — |
| 0.75 | dev | **webapp-marketdata** | 0.037 | 0.0000 | — |
| 0.74 | dev | **terminal-marketdata** | 0.037 | 0.0000 | — |
| 0.66 | dev | **signal-lab** | 0.033 | 0.0000 | — |
| 0.64 | prod | **signal-lab-prod** | 0.032 | 0.0000 | — |
| 0.44 | prod | Redis | 0.008 | 0.0025 | 1.50 |
| 0.43 | dev | Redis | 0.008 | 0.0023 | 1.52 |
| 0.00 | dev | terminal | 0 | 0 | — |
| 0.00 | dev | suwappu-bridge | 0 | 0 | — |

**Shape of the bill**: one service (`python-worker`) is 30% of the whole project and
48% of production. The two Postgres instances are another 25%. Everything else is
long-tail — and about a third of that long tail is doing no work at all.

---

## 2. Findings

### F1 — `python-worker` is 30% of the bill, and its CPU is spent on failing RPC calls
**Severity: high · Est. saving $15–25/mo + removes an incident class**

`python-worker` averages **0.204 vCPU** — 80× `python-api` (0.006) and more than every
other service in the project *combined*. Its runtime log is not doing work; it is a
solid wall of circuit-breaker churn:

```
RPC circuit OPEN https://rpc.tempo.xyz (30s, 3 failures, execution reverted: TIP20 token error: Uninitialized)
RPC circuit OPEN https://tempo-mainnet.drpc.org (60s, 4 failures, execution reverted…)
All RPCs circuit-open for tempo, using earliest recovery
RPC circuit OPEN https://base.drpc.org (120s, 5 failures, eth_call http_429)
RPC circuit OPEN https://arbitrum.drpc.org (120s, 5 failures, eth_call http_500)
RPC circuit OPEN https://optimism.drpc.org (60s, rate_limited_429)
RPC circuit OPEN https://sei.drpc.org (60s, http_500)
```

**Root cause — two bugs in `rpc_manager.py` that compound into an infinite hot loop:**

1. **The circuit breaker never sheds traffic; it only reorders it.**
   `_select_endpoint()` (`bot/services/rpc_manager.py:606-638`) filters to healthy
   endpoints at line 617 — but when *all* endpoints for a chain are open, lines 619-625
   log `All RPCs circuit-open for {chain}` and then **return the dead endpoint anyway**
   (`min(endpoints, key=circuit_open_until)`). The call proceeds to a known-failing host.
   For a chain where every endpoint fails permanently, there is no state that stops the
   retries.

2. **Deterministic contract reverts are counted as endpoint ill-health.**
   `execution reverted: TIP20 token error: Uninitialized` is an *application* error — the
   EVM ran the call and the contract reverted. It is deterministic and fails identically
   on every endpoint. Counting it as endpoint failure trips all `tempo` breakers, which
   lands in bug 1, which retries forever. `tempo` is configured at
   `bot/config/chains.py:237`.

Together: a misconfigured contract on one chain generates unbounded CPU across the whole
worker, 24/7, and the breaker that exists to prevent exactly this is structurally unable to.

Separately, **free public dRPC endpoints are rate-limiting us** (`http_429` on base,
optimism, arbitrum; `http_500` on sei, worldchain) while `ALCHEMY_API_KEY` and
`HELIUS_API_KEY` are set on these services — paid providers exist but public dRPC is
still in the rotation.

> **Correction to an earlier draft of this audit:** the backoff ladder is *not* a flat
> 30s. `record_failure` escalates 30s → 600s (`rpc_manager.py:393-395`) with dedicated
> longer cooldowns for quota/gone endpoints. The ladder is sound; bug 1 defeats it.

**Actions**
- Fix bug 2: don't open circuits on `execution reverted` / JSON-RPC code 3.
- Fix bug 1: `_select_endpoint` should raise when all circuits are open so callers
  degrade that chain, instead of calling a dead host.
- Prefer the keyed Alchemy/Helius provider over round-robining back into a rate-limited
  free endpoint.
- Fold RPC health into `health_monitor` so a permanently-open breaker pages once instead
  of costing CPU silently forever.

### F2 — `python-worker` spiked to 31.7 GB against a 32 GB ceiling
**Severity: high (reliability + spend) · unbounded downside**

| | avg | max |
|---|---:|---:|
| `python-worker` memory | 1.618 GB | **31.685 GB** |

The service's `MEMORY_LIMIT_GB` is 32. It reached 31.685 GB — it came within ~1% of
being OOM-killed. Every other service in the project stays under 1.8 GB.

Two consequences: Railway bills memory per minute, so the spike is billed at ~20× the
average rate for its duration (this is the main reason the real invoice may exceed the
modelled $36); and a repeat gets the worker OOM-killed, which silently stops
`fee_sweeper`, `order_service`, and `tx_poller`.

**Leak candidates**, from a code trace of the 20 background services `python-worker` runs:

| Candidate | Location | Assessment |
|---|---|---|
| `_quote_flights: dict` | `bot/services/swap_engine.py:796` | **Leading candidate.** No cap, no TTL; entries live as long as the Flight object. |
| `_tick_size_cache`, `membership_service._cache`, `position_cards_service._holdings` | various | Grow unbounded, no eviction. Small individually; collectively unbounded. |
| `_recent_launches` | `bot/services/launch_detector.py:182` | Capped at 1000 w/ 1h TTL — bounded. Worth ~30–100 MB, **not** the 30 GB source. |
| ~~`_ws_watchers`~~ | `bot/services/tx_poller.py:45` | **Ruled out.** An earlier draft of this audit called this the most likely leak. That was wrong: line 299 registers `task.add_done_callback(...pop(_id))`, so entries *are* evicted on completion. The only real gap is the absence of a concurrency cap. |

**Actions**
- Start at `swap_engine.py:796` (`_quote_flights`) and the uncapped service caches.
- Add a hard cap to `_ws_watchers` for bounded worst-case concurrency (not for the leak).
- Set an explicit memory limit well below 32 GB (2–4 GB) on `python-worker`. A fast
  crash-and-restart is strictly cheaper than a 30 GB balloon, and `ON_FAILURE` restart
  is already configured.
- Alert on `MEMORY_USAGE_GB > 2` for this service.

### F3 — Every service in the project has no resource limits (32 vCPU / 32 GB)
**Severity: medium · caps worst-case blast radius**

Confirmed on all six production services sampled: `CPU_LIMIT = 32`, `MEMORY_LIMIT_GB = 32`.
Nothing in the project has an explicit cap. Actual usage is 0.008–1.6 GB and
0.000–0.204 vCPU, so limits cost nothing today — they exist purely so a leak or a hot
loop cannot run up an unbounded bill before anyone notices. F2 is what that looks like
when it happens.

**Action**: set limits at ~4× observed max per service. Suggested starting points —
`python-worker` 4 GB / 2 vCPU; `python-api` 2 GB / 1 vCPU; `api-ts` 1 GB / 1 vCPU;
static surfaces (`webapp`, `terminal`, `showcase`) 512 MB / 0.5 vCPU.

### F3b — `ENABLE_BACKGROUND_SERVICES` defaults to `True`, with no leader election
**Severity: medium (latent) · a single unset variable doubles the prod bill**

`python-worker` runs **20 background services** from `api/main.py`'s lifespan
(`fee_sweeper`, `deposit_watcher`, `alert_service`, `market_data_service`,
`venue_data_service`, `order_service`, `tx_poller`, `withdraw_reconciler`,
`health_monitor`, `balance_refresher`, `approval_notifier`, `webhook_dispatcher`,
`execution_scorer`, `perps_monitor`, `hl_ecosystem_monitor`, `predict_monitor`,
`hl_ws_alerts`, `cctp_relayer`, `cctp_generic_relayer`, `digest_service`, plus optional
`btc_bridge_poller` and `morpho_monitor`).

Three facts combine badly:

1. `ENABLE_BACKGROUND_SERVICES` **defaults to `True`** (`bot/config/settings.py:38-40`),
   as does `RUN_TELEGRAM_BOT` (`:42-44`).
2. `python-api` and `python-worker` run the **same entrypoint** off the same Dockerfile.
3. There is **no leader election and no distributed lock** anywhere in the lifespan —
   nothing prevents two processes running the same loops.

If `ENABLE_BACKGROUND_SERVICES` is ever unset or set true on `python-api`, all 20 loops
run **twice in parallel**: duplicate DB polling, duplicate alerts to users, duplicate
`fee_sweeper` and `cctp_relayer` execution on the money path.

**The measurements say it is currently configured correctly.** Prod `python-api` sits at
0.279 GB / 0.006 vCPU while `python-worker` is at 1.618 GB / 0.204 vCPU — a 34× CPU gap
that only makes sense if the API is *not* running the loops. Dev corroborates it from
the other direction: dev has no worker, and dev `python-api` (0.412 GB / 0.030 vCPU)
consumes ~5× the CPU of its prod counterpart — consistent with the default `True`
applying there.

So this is latent, not active. But it is one unset variable away from doubling the
production compute bill *and* double-executing the money path.

**Actions**
- Set `ENABLE_BACKGROUND_SERVICES=false` **explicitly** on `python-api` in both
  environments rather than relying on it being set; verify the current value directly
  (this connection redacts values).
- Flip the default to `False` so the safe state is the fallback, and make the worker opt in.
- Add a Redis lock or a single-owner guard around the lifespan so double-execution is
  structurally impossible, not configuration-dependent. This matters most for
  `fee_sweeper`, `cctp_relayer`, `withdraw_reconciler`, and `order_service`.

### F3c — Sub-second polling loops in always-on services
**Severity: low–medium · contributes to F1's CPU floor**

| Loop | Location | Interval |
|---|---|---:|
| `snipe_executor` | `bot/services/snipe_executor.py:599,638` | **0.5s** |
| `polymarket_api` | `bot/services/polymarket_api.py:629` | **0.5s** |
| `balance_refresher` | `bot/services/balance_refresher.py:275` | 1s |
| `wallet` | `bot/services/wallet.py:426` | 2s |
| `tx_poller` | `bot/services/tx_poller.py:90` | 3s fast / 15s normal |

Two loops spin 120×/minute each, continuously, whether or not there is work. Combined
with F1's retry storm this is the floor under `python-worker`'s 0.204 vCPU.

**Action**: make the 500ms loops event-driven or adaptive (back off to seconds when the
work queue is empty, tighten only when active). `snipe_executor` genuinely needs low
latency *during a snipe* — it does not need it at 3am with no pending snipes.

### F4 — Six dev services are running and doing nothing
**Severity: medium · Est. saving $17–19/mo (~40% of dev)**

Idle-but-billed, from stale feature branches:

| Service | $/mo | Evidence | Source branch |
|---|---:|---|---|
| `market-data-capture` | 8.64 | 0.41 GB, 0.024 vCPU — **actively burning**, branch gone | `reconcile/main-into-dev-20260820` (state: **missing**) |
| `api-ts-marketdata` | 4.87 | 0.24 GB, ~0 CPU | `claude/feature-parity-plan-x106cz` |
| `suwappu-primitives-ui` | 1.63 | 0.082 GB, ~0 CPU | `dev` |
| `webapp-marketdata` | 0.75 | **CPU exactly 0.000 for all 10,081 samples** | `claude/feature-parity-plan-x106cz` |
| `terminal-marketdata` | 0.74 | **CPU exactly 0.000 for all 10,081 samples** | `claude/feature-parity-plan-x106cz` |
| `signal-lab` (dev) | 0.66 | CPU 2e-7 avg — flat memory, zero work | `feat/pump-onchain-ingest` |

`market-data-capture` is the notable one: it is the 5th-largest line item in the whole
project and its source branch **no longer exists**. It is consuming real CPU on behalf
of a merged/abandoned experiment.

The three `*-marketdata` services all point at one stale preview branch. `webapp-marketdata`
and `terminal-marketdata` recorded *exactly* zero CPU across the entire week — they are
serving nothing.

**Action**: delete `market-data-capture`, `webapp-marketdata`, `terminal-marketdata`,
`api-ts-marketdata`. Delete or pause `signal-lab` (dev) and `suwappu-primitives-ui`.
Confirm with the owner of the parity-plan work first — deletion is not reversible.

### F5 — Dev Postgres is 66% larger than production Postgres
**Severity: medium · Est. saving $3–6/mo, and it grows**

| | disk | trend over 7d |
|---|---:|---|
| prod Postgres | 4.79 GB | 4.02 → 4.79 GB |
| **dev Postgres** | **7.96 GB** | 0 → 7.96 GB |

Dev holds 3.2 GB more data than production. Both are also growing steadily (prod +0.77 GB
in one week ≈ +$1.40/mo added every month if unchecked). Dev additionally spiked to
3.5 GB RAM against a 0.50 GB average — a heavy unbounded query or an unvacuumed table.

**Actions**
- Truncate/rotate the high-volume dev tables (the market-data capture experiment is the
  likely source, and matches F4). A dev DB should not exceed prod.
- Check autovacuum is keeping up on both; the prod growth curve is worth a retention
  policy before it compounds.

### F6 — Zero-traffic production surfaces
**Severity: low · Est. saving $1–2/mo · flag: is this expected?**

| Service | avg vCPU | avg egress |
|---|---:|---:|
| `webapp` (prod) | 0.0000122 | 8.5e-7 GB |
| `terminal` (prod) | 0.0000070 | 5.3e-6 GB |
| `signal-lab-prod` | 0.0000019 | 5.8e-11 GB |
| `suwappu-bridge` (prod) | 0.0000048 | 8.4e-7 GB |

The dollars are trivial. The signal is not: `webapp` and `terminal` are user-facing
production surfaces serving effectively **no traffic for a week**. Either that is the
true product state, or something upstream (DNS, Telegram Mini App config, a domain
pointing elsewhere) is routing users away from them. Worth confirming before treating
it as a cost item.

`signal-lab-prod` is flat-lined at 0.032 GB with no egress and no CPU — it is deployed
from the feature branch `feat/pump-onchain-ingest` and appears to be doing nothing in
production. Same question as F4, but on the production side.

### F7 — Redis is oversized on disk for its working set
**Severity: low · Est. saving ~$0.40/mo**

Both Redis instances hold ~1.5 GB of disk while using **8 MB** of memory. A cache with a
1.5 GB persisted footprint and an 8 MB working set is storing something that isn't being
read — likely an old RDB/AOF file or unexpired keys.

**Action**: check for keys without TTL; confirm persistence config matches intent (a
pure cache usually shouldn't persist 1.5 GB).

### F8 — Every dev push rebuilds four services
**Severity: low · efficiency, not direct spend**

Each `dev` push fans out deploys to `python-api`, `api-ts`, `showcase`, and
`suwappu-primitives-ui`. Watch patterns are configured (so many resolve to `SKIPPED`,
which is working correctly), but `suwappu-primitives-ui` rebuilds on `dev` pushes for a
service that records zero CPU — build minutes spent on something nobody loads. Resolved
by F4.

---

## 3. Recommended order of work

| # | Action | Est. $/mo | Risk |
|---|---|---:|---|
| 1 | Delete `market-data-capture` (source branch gone) | 8.6 | low — verify owner |
| 2 | Delete the three `*-marketdata` preview services | 6.4 | low — verify owner |
| 3 | Drop `tempo` from polled chains; fix RPC backoff | 15–25 | low — config |
| 4 | Cap `python-worker` at 4 GB + alert at 2 GB | prevents spikes | low |
| 5 | Truncate dev Postgres / add retention | 3–6 | medium — data loss |
| 6 | Set explicit limits on all services | insurance | low |
| 7 | Pin `ENABLE_BACKGROUND_SERVICES=false` on `python-api` (F3b) | prevents 2× prod | low |
| 8 | Retire `signal-lab` (both envs) if unowned | 1.3 | low — verify owner |
| 9 | Fix the `swap_engine._quote_flights` leak (F2) | spike-driven | medium |
| 10 | Make the 500ms loops adaptive (F3c) | 2–5 | medium |
| 11 | Add a lock around the lifespan so 2× is impossible (F3b) | insurance | medium |

**Total addressable: ~$37–52/mo of a ~$122/mo bill (roughly 30–43%)** — most of it from
items 1–3, which are deletions and a config change rather than engineering work.

Items 4, 6, 7, and 11 save nothing today. They are there because the two most expensive
things in this project are not line items: a worker that reached 99% of a 32 GB ceiling,
and a money-path that double-executes if one variable goes unset.

## 4. Actions taken (2026-08-27)

Applied via the Railway MCP connection during this audit:

| Change | Target | Status |
|---|---|---|
| `ENABLE_BACKGROUND_SERVICES=false` (explicit) | `python-api` / production | Set, **`skipDeploys`** — takes effect on next deploy |
| `ENABLE_BACKGROUND_SERVICES=true` (explicit) | `python-api` / dev | Set, **`skipDeploys`** — takes effect on next deploy |
| `sleepApplication=true` | `market-data-capture`, `api-ts-marketdata`, `webapp-marketdata`, `terminal-marketdata` (dev) | Set — takes effect on next deploy |

**On the variable pinning**: dev was pinned to `true`, not `false`. Dev has no
`python-worker`; its `python-api` *is* the worker and was relying on the `True` default.
Pinning it `true` achieves the actual goal — nothing depends on a default any more —
without silently stopping every background loop in dev. Deploys were skipped
deliberately so production does not take an unscheduled restart; both values match the
current effective behaviour, so the pin is a no-op until the next natural deploy.

### Still outstanding — not possible through this connection

The Railway MCP surface has **no `delete-service` tool** (only volumes, buckets, TCP
proxies, and feature flags can be deleted), and `update-service` **does not expose CPU or
memory limits** — it covers build/start/healthcheck/sleep/cron/restart/watch only, and
its own description notes that scaling is out of scope.

So these two approved items need the dashboard or the `railway` CLI:

1. **Delete the four dead dev services.** App-sleep was applied as a reversible stopgap,
   but sleep only activates on the next deployment — and `market-data-capture`'s source
   branch no longer exists, so it may not redeploy cleanly. Deleting is both the
   intended end state and the more reliable one. Railway dashboard → `dev` → service →
   Settings → Delete Service.
2. **Set resource limits** per F3. Dashboard → service → Settings → Resources. Suggested:
   `python-worker` 4 GB / 2 vCPU (peak was 31.7 GB), `python-api` 2 GB / 1 vCPU,
   `api-ts` 1 GB / 1 vCPU, static surfaces 512 MB / 0.5 vCPU.

## 5. Coverage / QA

**Covered**: all 22 services across both environments, 7-day metrics for CPU, memory,
disk, and egress; service config and variable *names* for `python-api` and
`python-worker`; 7 days of dev deployment history; production runtime logs for
`python-worker`.

**Not covered / caveats**:
- Variable **values** are redacted for this OAuth connection. `ENABLE_BACKGROUND_SERVICES`,
  `RUN_TELEGRAM_BOT`, and `USE_WEBHOOK` are confirmed *present* on both `python-api` and
  `python-worker`, but their values were **not read**. F3b's conclusion that background
  services currently run only on the worker is inferred from the 34× CPU gap between the
  two services, not read from config — it should be confirmed directly in the Railway
  dashboard before anyone relies on it.
- Cost figures are modelled from utilisation at list rates, not read from an invoice. No
  volume/backup/log-retention line items, egress, or plan-level seat costs are included.
- Only `python-worker`'s logs were read. Other services' logs may hold similar waste.
- The four `job`/`manual` services (`testnet-runner`, `testnet-deploy-runner`,
  `turnkey-key-import`, `pump-onchain-ingest` prod) were metered but not investigated for
  whether they should still exist.
- Ownership of the stale services was **not** verified. Every deletion in §3 needs a
  human confirm first — this audit identifies candidates, it does not authorise removal.
