# Product A Spec — Suwappu Cross-Chain Flow Index (SCFI)

> **Status:** Draft / for review. Not yet approved for build.
> **Owner:** TBD · **Legal gate:** ToS + privacy review MUST pass before any external exposure (see §8).
> **One-liner:** An aggregated, anonymized market-intelligence feed of cross-chain retail swap behavior — sellable to crypto data aggregators, quant firms, and AI/DeFAI builders **without ever exposing individual users**.

---

## 1. Why this product (and not raw data)

Suwappu's differentiated asset is **cross-chain retail intent + order flow across 30+ chains** routed through Li.Fi / Jupiter / 1inch. Raw chain data is commoditized (anyone can index it); what we uniquely have is the *connected, pre-trade, retail-attributed* journey.

The Flow Index packages that edge as **aggregate statistics only**. No row in any output maps to a person, a wallet, or a single transaction. This is the version that is:
- **Legally defensible** — aggregated data is excluded from both GDPR and CCPA scope.
- **Reputationally survivable** — no user can claim "you sold my trades."
- **Sellable to all three buyer segments** without a per-deal compliance renegotiation.

Everything user-level, pseudonymized, or opt-in is explicitly **out of scope** for Product A (see Product B/C in the parent research report).

---

## 2. The anonymization boundary (the core of the spec)

This is the most important section. The boundary is enforced **in the aggregation job**, not at the API layer.

**Inputs (internal, behind the boundary):** raw `swap_transactions`, `fee_transactions`, `snipe_history` joined on `user_id`.

**Outputs (external, in front of the boundary):** only pre-aggregated metric rows keyed by *dimensions* (chain, token, time bucket, route provider) — never by `user_id`, wallet address, `tx_hash`, Telegram ID, or any identifier.

### Hard rules enforced by the aggregation job
1. **No identifiers cross the boundary.** `user_id`, `telegram_id`, wallet addresses, `tx_hash`, `bridge_tx_hash`, `idempotency_key`, `agent_uuid`, IP, `region`-at-user-level are dropped before aggregation output. (`route_data` JSON is parsed for route shape, then discarded — it can contain addresses.)
2. **k-anonymity threshold:** any aggregate cell (e.g. a token/chain/hour bucket) is **suppressed (returned as `null`/withheld) if it is composed of fewer than `k = 20` distinct users.** This prevents re-identification of a single whale's trades.
3. **No "unique user" counts below threshold are ever emitted** — only bucketed ranges (`<50`, `50–500`, `500+`) for cardinality fields, never an exact distinct-user count that could fingerprint a cohort.
4. **Minimum bucket granularity = 1 hour.** No per-minute/per-second buckets (would isolate individual launch snipes).
5. **USD amounts are reported as aggregates only** (sum, median, percentiles) — never an individual `from_amount_usd`.
6. **Token allow-list:** only tokens above a liquidity/holder floor are reported, so a freshly-launched token traded by 2 users can't be reverse-engineered.

> Implementation note: the boundary should be a **separate read-only database role / materialized-view layer** that physically cannot select identifier columns. Defense in depth — even a buggy API query can't leak PII because the underlying view doesn't contain it.

---

## 3. Metric catalog (MVP)

All metrics are computed per **time bucket** (default 1h / 1d / 1w) and sliced by the dimensions in §4. Source columns are real (`api-ts/src/db/schema/`).

### 3.1 Flow & volume
| Metric | Definition | Source |
|--------|-----------|--------|
| `net_flow_usd` | Σ `to_amount_usd` − Σ `from_amount_usd` per token (directional retail pressure) | `swap_transactions.from_amount_usd`, `to_amount_usd` |
| `gross_volume_usd` | Σ `from_amount_usd` (confirmed only) | `swap_transactions` |
| `swap_count` | count of `status='confirmed'` swaps | `swap_transactions.status` |
| `avg_swap_size_usd`, `median_swap_size_usd`, `p90_swap_size_usd` | size distribution | `from_amount_usd` |
| `unique_traders_bucketed` | distinct `user_id` count → **emitted as range, not exact** (§2.3) | `swap_transactions.user_id` (internal only) |

### 3.2 Cross-chain routing intelligence *(the differentiated layer)*
| Metric | Definition | Source |
|--------|-----------|--------|
| `chain_pair_flow` | volume/count per `(from_chain → to_chain)` ordered pair | `from_chain`, `to_chain` |
| `route_provider_share` | % of volume per `route_provider` (lifi/jupiter/1inch) per chain pair | `route_provider` |
| `bridge_corridor_demand` | top destination chains given a source chain | `from_chain`, `to_chain` |

### 3.3 Execution-quality signal *(quant-relevant)*
| Metric | Definition | Source |
|--------|-----------|--------|
| `median_slippage_setting_bps` | median configured slippage (proxy for urgency) | `swap_transactions.slippage` |
| `fail_rate` | failed / total, sliced by chain & `error_category` | `status`, `error_message` |
| `median_gas_fee_usd`, `median_bridge_fee_usd` | cost of execution by chain | `gas_fee`, `bridge_fee` |

### 3.4 Solana launch-snipe analytics *(exclusive data)*
| Metric | Definition | Source |
|--------|-----------|--------|
| `snipe_success_rate` | successful / attempted snipes per platform (Pump.fun/Raydium) | `snipe_history`, `auto_snipe_rules.total_snipes/successful_snipes` |
| `median_snipe_execution_ms` | execution latency distribution | `snipe_history.execution_time_ms` |
| `launch_snipe_volume_sol` | aggregate SOL deployed into launches | `snipe_history.sol_spent` |

> **Excluded from MVP:** anything from copy-trade graphs, referral graph, PnL/cost-basis, P2P counterparties — these are higher re-identification risk and belong to Product B/C with explicit consent.

---

## 4. Dimensions (slice-by)

- `time_bucket` — `1h` | `1d` | `1w` (ISO start timestamp, UTC)
- `chain` / `from_chain` / `to_chain` — from the 30+ supported chains
- `token` — symbol, restricted to the liquidity allow-list (§2.6)
- `route_provider` — `lifi` | `jupiter` | `1inch` | …
- `region_bucket` — **coarse only** (continent or "top-10 vs rest"), never user-level country, to avoid small-cohort leakage

---

## 5. API shape

Reuse the existing Hono + Effect-TS API and the `agents` / `apiCredits` / `subscriptions` billing rails already in the schema — **a data customer is just an `agent` with a `data` subscription tier.** No new auth system.

```
GET /v1/data/flow-index
  ?metric=net_flow_usd
  &granularity=1d
  &from=2026-06-01&to=2026-06-29
  &chain=base               # optional filter
  &token=USDC               # optional filter
  &route_provider=lifi      # optional filter
Auth: X-API-Key (existing agent key) → gated by subscription tier = 'data'
```

**Response (cells below k=20 are omitted, not zero-filled):**
```json
{
  "metric": "net_flow_usd",
  "granularity": "1d",
  "currency": "USD",
  "anonymization": { "k_threshold": 20, "suppressed_cells": 4 },
  "series": [
    { "bucket": "2026-06-27T00:00:00Z", "chain": "base", "token": "USDC",
      "value": 412900.50, "swap_count": 1840, "unique_traders": "500+" },
    { "bucket": "2026-06-28T00:00:00Z", "chain": "base", "token": "USDC",
      "value": 388210.00, "swap_count": 1610, "unique_traders": "500+" }
  ]
}
```

Companion endpoints:
- `GET /v1/data/catalog` — list available metrics, dimensions, coverage window, freshness.
- `GET /v1/data/chain-pairs` — §3.2 corridor matrix.
- **Bulk export:** signed S3/Parquet daily snapshots for licensing customers who want the whole feed (same k-anonymity rules applied at export time).

---

## 6. Aggregation architecture

1. **Materialized views / rollup tables** computed by a scheduled job (fits the existing background-service pattern in `api/main.py` lifespan — add a `flow_index_aggregator`).
2. Job reads raw tables via the **restricted read-only role** (§2), applies k-anonymity suppression, writes to `flow_index_*` rollup tables that contain **no identifiers**.
3. API serves only from rollup tables. The hot path never touches `swap_transactions` directly.
4. Refresh cadence: hourly for `1h`, nightly recompute for `1d`/`1w`. Reuse `fee_summaries` as the precedent (it already does period rollups with `chain_breakdown`).

---

## 7. MVP scope vs later

**MVP (ship first):** §3.1 flow/volume + §3.2 chain-pair routing, `1d`/`1w` granularity, JSON API + daily Parquet export, gated by `data` subscription tier. This alone is the "teaser + inbound magnet."

**V2:** §3.3 execution-quality + §3.4 snipe analytics, `1h` granularity, streaming/webhook delivery (reuse `webhook_events`).

**Not in Product A:** user-level / pseudonymized data, copy-trade or referral graphs, PnL — those require Product B/C and explicit consent.

---

## 8. Compliance & launch guardrails (blocking)

- [ ] **ToS / privacy-policy review** confirms aggregated data sale is permitted (check what `users.tos_accepted` actually covered). **Blocks all external exposure.**
- [ ] Anonymization boundary implemented as a physically separate read-only role/view (not just app logic).
- [ ] k-anonymity (k≥20) + cell suppression verified with a re-identification test on real data.
- [ ] Public-facing one-pager states clearly: aggregated, no individual user/wallet data, no PII.
- [ ] (Recommended) Opt-out honored even though aggregated — pre-empts reputational risk; pairs with future Product C opt-in.

---

## 9. Open questions for product/legal

1. Does current ToS permit aggregated commercial data products, or do we need a ToS update + user notice first?
2. Pricing model: flat license, usage-metered (per the `apiCredits` ledger), or revenue-share with an aggregator partner?
3. Go direct, or license through an existing aggregator (Kaiko/Nansen-type) for distribution + compliance cover? (See parent report §3, §7.)
4. Is `k=20` the right floor, or should it scale per metric sensitivity?
