# Metrics

Why this matters for Gekko: without an agreed metrics dictionary, "growth" becomes whatever number looks best that week. This doc defines the North Star and supporting metrics Gekko tracks from launch, with instrumentation notes pointing at Suwappu's existing data (fee ledger, wallet balances, XP/referral tables) so nothing here requires a new analytics stack to start.

## Total Deposits

### Definition
The sum of all customer stablecoin/token balances held across Gekko wallets at a point in time (custodial + non-custodial where trackable on-chain).

### Formula / instrumentation
- Sum of on-chain balances per wallet address via existing multicall3 balance-read infra (already used for portfolio views).
- Segment by chain (7+ chains supported) and by asset (stablecoin vs. volatile token) since only stablecoin balances are yield-eligible.

### Target
- Target: track as an absolute dollar figure and month-over-month growth rate; set numeric target after first full quarter of Savings launch data.

## Average Balance

### Definition
Total Deposits divided by the number of funded accounts — a proxy for how "primary" Gekko is to a given user's finances.

### Formula / instrumentation
- Total Deposits ÷ count of wallets with balance > $0 (or a minimum threshold, e.g. $1, to exclude dust).
- Track median alongside mean — crypto balance distributions are typically right-skewed by whales.

### Target
- Target: median average balance $200+ within 12 months (verify against early cohort data before treating as firm).

## TPV

### Definition
Total Payment Volume — the sum of all money movement through Gekko: swaps, card spend, transfers, and DCA executions, over a period.

### Formula / instrumentation
- Sum of swap volume (existing fee-ledger data) + card spend (once card ships, from processor settlement data) + P2P/name-based payment volume.
- Report gross TPV and TPV by product line separately, since swap volume and card spend have very different margin profiles (see `14-monetization.md`).

### Target
- Target: track monthly TPV growth rate; no absolute floor set until card ships (TPV will be swap-dominated pre-card).

## Card Spend

### Definition
The subset of TPV that flows through the Gekko debit card specifically — the primary driver of interchange revenue.

### Formula / instrumentation
- Pulled directly from card processor (Marqeta/Lithic-style) settlement feed once integrated; not derivable from on-chain data alone since card auth/settlement happens off-chain.
- Segment by MCC (merchant category code) to inform future personalization/rewards design.

### Target
- Target: $150+ average monthly card spend per active cardholder within 12 months of card launch (verify against comparable neobank cohorts, treat as provisional).

## Funded Accounts

### Definition
The count of unique users who have deposited or hold a non-zero balance in Gekko — the denominator for most per-customer metrics in `15-unit-economics.md`.

### Formula / instrumentation
- Count of unique wallet/user IDs with balance > $0, deduplicated against the existing Suwappu user table (avoid double-counting existing trading users who simply activate Gekko features).

### Target
- Target: 25% of existing active Suwappu traders converted to at least one funded Gekko balance within 6 months of launch (cross-sell-first strategy, see `15-unit-economics.md` CAC section).

## Products Per Customer

### Definition
The average count of distinct Gekko product surfaces (swap, savings/yield, DCA, card, credit, payments) an active customer uses in a given period — the core multi-product-expansion metric from `16-retention.md`.

### Formula / instrumentation
- Per-user flag for activity in each product line per month (boolean per product), summed and averaged across active users.
- Derivable from existing per-service activity logs (swap service, order service) plus new logs for savings/card/credit once shipped.

### Target
- Target: 2.0 products/customer average within 12 months (mirrors `16-retention.md` target).

## Gross Margin

### Definition
Blended and per-line gross margin as defined in `15-unit-economics.md` — revenue minus direct cost of serving, expressed as a percentage.

### Formula / instrumentation
- (Total revenue - direct COGS: processor fees, compliance vendor costs, custody/infra) ÷ total revenue, computed monthly per revenue line and blended.
- Pull revenue from the existing fee ledger + new interchange/subscription revenue feeds once live; pull COGS from processor invoices and infra spend.

### Target
- Target: 55%+ blended gross margin at steady state (mirrors `15-unit-economics.md`).

## CAC / LTV

### Definition
Customer Acquisition Cost and Lifetime Value as defined in `15-unit-economics.md`, tracked together as a ratio to judge whether growth spend is sustainable.

### Formula / instrumentation
- CAC: (marketing spend + referral payouts) ÷ new funded accounts in period, pulled from the existing referral/XP payout ledger plus any paid-marketing spend tracking.
- LTV: cumulative expected gross-margin revenue per customer over observed/modeled tenure — do not compute until at least 3 months of retention-cohort data exists.

### Target
- Target: LTV:CAC ≥ 3:1 within 18 months (mirrors `15-unit-economics.md`).

## Net Revenue Retention

### Definition
NRR measures how revenue from an existing cohort of customers changes over time (expansion from upsells/cross-sell minus contraction from churn/downgrade), excluding new-customer revenue — a key indicator of whether the multi-product strategy in `16-retention.md`/`20-product-expansion.md` is working.

### Formula / instrumentation
- (Revenue from a cohort this period) ÷ (revenue from the same cohort in a base period), cohort-based, computed monthly rolling on a fixed acquisition cohort.
- Requires stable per-user revenue attribution across swap fees, yield spread, interchange, and subscriptions — build this as a single per-user revenue rollup view rather than reconciling separate ledgers ad hoc.

### Target
- Target: NRR ≥ 100% (net expansion, not just retention) within 12 months of multi-product launch — i.e., existing cohorts should grow in revenue via cross-sell faster than they shrink from churn.
