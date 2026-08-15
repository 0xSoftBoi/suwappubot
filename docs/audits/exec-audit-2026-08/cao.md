# CAO Metrics Audit — Aug 2026

Scope: what's measurable today from `bot/models/` (Python/SQLAlchemy) and `api-ts/src/db/schema/` (Drizzle), for the pricing decision in `docs/business/pricing-model-2026-08.md`.

## 1. Metric readiness table

| KPI | Status | Source (table.column) |
|---|---|---|
| Wallets created (count) | **Measurable now** | `wallets` (Python `bot/models/user.py:113` / TS `api-ts/src/db/schema/wallets.ts`) — `COUNT(*)`, `.created_at` for date range |
| Wallets funded (≥1 deposit) | **NOT recorded** | No deposit-event table exists (checked `bot/models/*` for `Deposit`/`first_activity` — only hit is unrelated `cctp.py` relayer bookkeeping). Funded status must be inferred indirectly from `swap_transactions.from_amount` > 0 as a proxy, which conflates "funded" with "swapped" |
| Active wallets (DAU/WAU) | **Partially** — derivable but undefined. `swap_transactions.created_at` per `user_id` gives an activity proxy; no `active` flag or rolling-window materialization exists. Definition (below) must be adopted and the query run fresh each report | `swap_transactions.user_id`, `.created_at` |
| Wallet activation funnel (created → funded → first swap) | **Partially** — only 2 of 3 stages measurable. `created` = `wallets.created_at`; `first swap` = `MIN(swap_transactions.created_at) GROUP BY user_id`; `funded` = **no column, no event** | `wallets.created_at`, `swap_transactions.created_at` (min) |
| Swap volume (USD) | **Measurable now** | `swap_transactions.from_amount_usd` / `.to_amount_usd` (quoted); `.realized_to_amount_usd` when populated (Li.Fi path only — mostly NULL, see caveat) |
| Fees collected per swap | **Measurable now**, two sources that can disagree | `fee_transactions.fee_amount_usd` (per-swap ledger, Python `bot/models/fees.py:32`) **and** `swap_transactions.fee_cost_usd` (api-ts `swaps.ts:45`, populated at execution time). Reconcile these — do not assume they're the same value without checking |
| Blended take rate (collected fees ÷ volume) | **Measurable now**, not currently computed anywhere | `SUM(fee_transactions.fee_amount_usd) / SUM(swap_transactions.from_amount_usd)` over a date range — no existing job/view does this; must be run ad hoc |
| Fee revenue per active wallet | **Partially** — both numerator and denominator exist but no query/report currently joins them | `fee_transactions` × `swap_transactions.user_id`, denominator = active-wallet definition above |
| Referral-sourced share of volume | **Measurable now** | `referrals` (referrer_id/referee_id) JOIN `swap_transactions` on `referee_id = user_id`; `referral_earnings.stream_type='swap'` gives paid-out commission, not gross volume — need the join for volume, not the earnings ledger |
| Tier mix (FREE/PRO/PREMIUM/ENTERPRISE) | **Measurable now** | `subscription` table (Python) / `subscriptions.ts` (TS) — `GROUP BY tier` |
| Bridge success rate | **Measurable now** | `bridge_transfers.state` (Python `bot/models/bridge.py:63`) — terminal states `complete`/`failed`/`stalled` give numerator/denominator by `provider`, `from_chain`/`to_chain` |
| Chip/button click-through | **NOT recorded at all** | No event-tracking table or analytics pipeline exists anywhere in the codebase (see §3). `bot/models/tracking.py` is unrelated — it stores user-configured watch-wallets/Twitter handles, not UI interaction events |
| Per-signature volume (Turnkey vs KMS cost) | **NOT recorded at all** | No signature-count column on `wallets`, no signing-event log. `wallet_provider`/`turnkey_sub_org_id` exist on `wallets` (`bot/models/user.py:138-141`) so Turnkey vs local wallets are distinguishable, but *frequency of signing* is not captured anywhere — turnkey_client.py signs and returns, nothing persists a per-call count |

## 2. Instrumentation gaps blocking the pricing decision

The pricing doc's core question — "how many wallets are actually *active* vs merely created, and how many signatures do they generate?" — cannot be answered from current schema:

- **Wallet count ≠ active wallet count.** `wallets` table has no activity flag; `COUNT(wallets)` (what a Turnkey invoice bills against) is NOT the same denominator as active-wallet revenue metrics. Conflating these is "the house error" — e.g. citing "2,000 wallets, $99/mo" against an active-wallet count would understate true idle-wallet cost bleed.
- **No per-signature counter.** The KMS-vs-Turnkey unit-economics table in the pricing doc (~10 sigs/wallet/mo estimate) is **an assumption, not a measurement** — nothing in `turnkey_client.py`, `wallet.py`, or the schema logs a signing event. Without this, the "$1-5/mo vs $99/mo" comparison at any wallet count is unverifiable against real usage.
- **No funded-wallet event.** Cannot compute wallet-activation funnel drop-off (created → funded → first swap) without a proxy; the proxy (first swap as funded-substitute) undercounts wallets that deposited but never swapped.
- **No idle/dormant-wallet aging.** The pricing doc's "activity-gated wallet creation" and "inactive-wallet reaping" phases both need a `last_signed_at` or `last_active_at`-equivalent on `wallets` — `wallets` currently has no last-activity column at all (only `created_at`). `users.last_active_at` exists but is at the user, not wallet, grain, and multiple wallets per user break that mapping.

## 3. Existing analytics/metrics code paths

Grepped `analytics|metrics|track_event|amplitude|mixpanel|posthog|segment` across the repo (60-file cap hit, reviewed all).

- **No product-analytics or event-tracking pipeline exists** (no Amplitude/Mixpanel/PostHog/Segment integration found).
- Hits are all unrelated: `*metrics*` in the codebase refers to **market-data** metrics (`perpMetrics.ts`, `lendMetrics.ts`, perps/lend venue data — trading metrics, not product/user metrics), or to swap-quality "execution intelligence" tables (`swap_route_candidates`, `swap_execution_marks` — genuinely useful for take-rate/execution-quality analysis, listed above).
- `fee_summaries` / `feeSummaries` table (`bot/models/fees.py:60`, `api-ts/src/db/schema/fees.ts:71`) is the closest thing to a rollup/reporting table (daily/monthly `total_swaps`, `total_volume_usd`, `total_fees_usd`) — but nothing in the codebase currently writes to it on a schedule; verify with `NEEDS-QUERY` below whether it's populated in prod or dead schema.
- `api_usage_daily` (`api-ts/src/db/schema/apiUsageDaily.ts`) meters x402/agent API usage per key/route/day — relevant to `caio`'s agent-economics domain, not wallet/swap KPIs.

## Definitions (publish with every report)

- **Created wallet**: row exists in `wallets`/`wallets.ts`, any `chain_type`, regardless of balance or activity.
- **Funded wallet**: NOT currently instrumented. Proposed definition once built: wallet with ≥1 confirmed on-chain deposit event (needs new table, see below).
- **Active wallet (proposed standard)**: wallet with ≥1 `swap_transactions.status='completed'` row in the trailing 30 days, keyed by `user_id` (not wallet-address, since users can hold multiple wallets per chain). State this denominator explicitly in every report as "active wallets (30d, ≥1 completed swap)."
- **Blended take rate**: `SUM(fee_transactions.fee_amount_usd) / SUM(swap_transactions.from_amount_usd)` for completed swaps in the period — actual collected, not the sticker bps in `TIER_FEE_RATES` (`bot/services/fee_service.py`).

## NEEDS-QUERY (run against prod DB)

```sql
-- 1. Wallets created vs active (30d), by provider — the core pricing-doc denominator
SELECT
  w.wallet_provider,
  COUNT(DISTINCT w.id) AS wallets_created,
  COUNT(DISTINCT CASE WHEN s.user_id IS NOT NULL THEN w.id END) AS wallets_active_30d
FROM wallets w
LEFT JOIN swap_transactions s
  ON s.user_id = w.user_id
  AND s.status = 'completed'
  AND s.created_at >= now() - interval '30 days'
GROUP BY w.wallet_provider;

-- 2. Blended take rate, last 30 days
SELECT
  SUM(ft.fee_amount_usd) / NULLIF(SUM(st.from_amount_usd), 0) AS blended_take_rate,
  SUM(ft.fee_amount_usd) AS fee_revenue_usd,
  SUM(st.from_amount_usd) AS volume_usd,
  COUNT(DISTINCT st.user_id) AS active_wallets
FROM swap_transactions st
JOIN fee_transactions ft ON ft.swap_id = st.id
WHERE st.status = 'completed' AND st.created_at >= now() - interval '30 days';

-- 3. Fee revenue per active wallet, last 30 days
SELECT
  st.user_id,
  SUM(ft.fee_amount_usd) AS fee_revenue_usd
FROM swap_transactions st
JOIN fee_transactions ft ON ft.swap_id = st.id
WHERE st.status = 'completed' AND st.created_at >= now() - interval '30 days'
GROUP BY st.user_id;

-- 4. Referral-sourced share of volume, last 30 days
SELECT
  SUM(CASE WHEN r.id IS NOT NULL THEN st.from_amount_usd ELSE 0 END) / NULLIF(SUM(st.from_amount_usd), 0) AS referral_volume_share
FROM swap_transactions st
LEFT JOIN referrals r ON r.referee_id = st.user_id AND r.is_active = true
WHERE st.status = 'completed' AND st.created_at >= now() - interval '30 days';

-- 5. Bridge success rate, last 30 days, by provider
SELECT
  provider,
  COUNT(*) FILTER (WHERE state = 'complete') * 1.0 / NULLIF(COUNT(*) FILTER (WHERE state IN ('complete','failed','stalled')), 0) AS success_rate,
  COUNT(*) AS total_transfers
FROM bridge_transfers
WHERE created_at >= now() - interval '30 days'
GROUP BY provider;

-- 6. Tier mix (current)
SELECT tier, COUNT(*) FROM subscriptions GROUP BY tier;

-- 7. Wallet-activation funnel proxy (created → first swap; "funded" not measurable)
SELECT
  DATE_TRUNC('week', w.created_at) AS cohort_week,
  COUNT(DISTINCT w.user_id) AS wallets_created,
  COUNT(DISTINCT fs.user_id) AS reached_first_swap
FROM wallets w
LEFT JOIN (
  SELECT user_id, MIN(created_at) AS first_swap_at
  FROM swap_transactions WHERE status = 'completed'
  GROUP BY user_id
) fs ON fs.user_id = w.user_id AND fs.first_swap_at >= w.created_at
GROUP BY 1 ORDER BY 1;

-- 8. Is fee_summaries actually being written in prod, or dead schema?
SELECT period_type, MAX(period_date), COUNT(*) FROM fee_summaries GROUP BY period_type;

-- 9. Per-signature volume proxy (COUNT of swap tx per turnkey wallet — undercounts
--    true signature count since one swap can involve approval + swap + bridge sigs;
--    this is the best available proxy until a signing-event log exists)
SELECT
  w.wallet_provider,
  COUNT(DISTINCT w.id) AS wallet_count,
  COUNT(st.id) AS swap_tx_count,
  COUNT(st.id) * 1.0 / NULLIF(COUNT(DISTINCT w.id), 0) AS avg_swap_tx_per_wallet_30d
FROM wallets w
LEFT JOIN swap_transactions st ON st.user_id = w.user_id AND st.created_at >= now() - interval '30 days'
WHERE w.wallet_provider = 'turnkey'
GROUP BY w.wallet_provider;
```

## Missing-instrumentation list (proposed columns/tables)

1. **`wallets.last_signed_at`** (timestamp, nullable) — set on every successful sign call (local or Turnkey). Required for idle-wallet reaping and per-wallet activity aging; currently `wallets` has only `created_at`.
2. **`wallet_signing_events`** (new table: `id`, `wallet_id`, `provider`, `signed_at`, `purpose` [approval/swap/bridge]) — append-only log of every signing call. This is the *direct* fix for the Turnkey-vs-KMS pricing question; without it, sig-count estimates stay UNVERIFIED per the pricing doc's own flag.
3. **`wallet_deposit_events`** (new table: `id`, `wallet_id`, `user_id`, `chain`, `token`, `amount_usd`, `tx_hash`, `detected_at`) — closes the "funded" gap in the activation funnel. Currently funded is only inferable by proxy through swap activity.
4. **`fee_summaries` write path** — verify (query 8) whether this table is populated by any scheduled job; if dead, either wire it up or deprecate it so it doesn't mislead a report author into trusting a stale rollup.
5. **No UI event tracking anywhere** — chip/button click-through requires a new event-ingestion path (e.g. `ui_events` table or a lightweight product-analytics integration) in `webapp/` and `bot/handlers/`. This is a net-new build, not a schema gap in an existing table.

## Caveats

- `swap_transactions.realized_to_amount_usd` is populated only on the Li.Fi path today; most rows are NULL. Volume metrics above use the quoted `from_amount_usd`/`to_amount_usd`, not realized fill — flag this in any report that claims "actual volume."
- `fee_transactions.fee_amount_usd` and `swap_transactions.fee_cost_usd` are two independently-written columns for what should be the same fact — reconcile before trusting either as sole source for take-rate math (query 2 uses the `fee_transactions` ledger since it's the dedicated fee-collection record).
- All active-wallet numbers depend on the 30-day/≥1-completed-swap definition adopted above; any report using a different window or funded-vs-swapped denominator must say so explicitly per the "no number without a denominator and date range" rule.
