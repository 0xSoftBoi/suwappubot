# Suwappu Pricing Strategy — 2026 Review

**Thesis: we are underpricing on every axis except the free-tier swap fee.**
Our subscription ladder ($9.99 / $29.99 / $99.99) was set at consumer-bot
price points, but the product we actually ship — a multi-chain execution API
with MCP, x402/agentic payments, perps, lending, prediction markets, and a
post-quantum settlement path — is infrastructure. Infrastructure is priced
per seat/per-call/per-volume, not at $9.99.

Sourced from code as of this commit, not from docs. All file refs are ground truth.

---

## Part 1 — Every way we currently make money

### 1.1 Swap execution fees (the real revenue engine)

**Telegram / consumer surface** — `bot/services/fee_service.py:34`

| Tier | Fee rate | Notes |
|------|----------|-------|
| FREE | 1.00% (100 bps) | `DEFAULT_FEE_RATE` fallback too |
| PRO | 0.50% | |
| PREMIUM | 0.30% | |
| ENTERPRISE | 0.10% | |

Fee is discountable twice: points-based `fee_discount` floored at
`MIN_EFFECTIVE_FEE_RATE`, then multiplicatively by position-card NFT holdings
(`fee_service.get_fee_decimal`). **This stacking is a revenue leak we price for below.**

**Agent / API surface** — flat, NOT tier-aware (`api-ts/src/config/constants.ts:42`, `EnvService.ts:170`)

| Route | Fee | Source |
|-------|-----|--------|
| Solana (Jupiter `platformFeeBps`) | 0.30% | `DEFAULT_AGENT_FEE_BPS = 30` |
| EVM (Li.Fi integrator fee) | 0.80% | `AGENT_FEE_FRACTION_EVM`, `SwapService.ts:450` |
| Starknet (AVNU) | 1.00% fallback | `avnu_integrator_fee_bps = 100` |
| NEAR Intents appFee | 0 bps (**disabled**) | `near_intents_fee_bps = 0` |

> **Finding A:** an enterprise API customer paying $99.99/mo still pays 30–80 bps
> on every swap, while a $99.99 Telegram user pays 10 bps. The two ladders are
> inconsistent and the API one is not tier-aware at all.
>
> **Finding B:** NEAR Intents fee is 0 and Allbridge/Lattice are dark — we route
> volume we earn nothing on.

### 1.2 Perps (HyperLiquid) — `bot/config/settings.py:360`
- Builder fee: `hl_builder_fee_tenths_bps = 10` → **1 bp (0.01%)**, ceiling approved at 0.1%.
- Plus HL referral code rewards (`hl_referral_code`).
- `HyperliquidService.ts:56` quotes `FEE_BPS = 2` indicatively.

> **Finding C:** we charge 1 bp against a 10 bp approved ceiling. Competing
> builder-code frontends charge 2.5–5 bps. This is a ~5x uncaptured spread on
> perps volume with zero user-facing repricing risk (the 0.1% approval already exists).

### 1.3 Subscriptions
Single price list, three consumers:
- Telegram/WhatsApp: `bot/services/x402_service.py:77` (`TIER_LIMITS`)
- Agent API crypto: `api-ts/src/config/constants.ts:84` (`TIER_PRICES_USD`), 30-day **prepaid, non-renewing** window
- Stripe checkout: `/billing/stripe/checkout` — human account plan, does **not** promote an Agent API key

pro $9.99 / premium $29.99 / enterprise $99.99 — identical numbers everywhere.

> **Finding D:** "enterprise" at $99.99/mo self-serve is a category error. No
> enterprise buyer evaluates a $99.99 SKU; it caps our ACV at $1.2k/yr and
> signals "hobby project" to the exact segment that pays the most.

### 1.4 Per-call metering (credits)
Free tier only, when `AGENT_METERING_ENABLED=true`. **1 credit ≈ $0.001**.
quote/portfolio/prices = 1 credit; swap/execute = 5 credits. All paid tiers bypass metering entirely.

> **Finding E:** $0.001/quote is ~10–50x below comparable market data + routing
> APIs, and paid tiers get *unlimited* calls. We monetize rate, not usage —
> so our heaviest agent users are our least profitable.

### 1.5 Rate-limit tiers (the only thing subscriptions actually buy)
free 30 rpm / agent 100 / pro 500 / premium 2,000 / enterprise 10,000 rpm.

### 1.6 Points, seasons & redemption (negative revenue)
- `api-ts/src/db/schema/points.ts:412` — redemption at **200 pts/$**; a month of pro costs 2,000 pts, enterprise 20,000 pts.
- Season referral cap 10,000 pts (`seasons.ts:137`).
- Referral fee share: **30% of collected fees** (`referral_reward_percentage = 30`).

> **Finding F:** 30% referral rev-share on top of a 1% fee that is itself
> discountable by points and NFTs means marginal fee revenue on a referred,
> points-rich, NFT-holding user can approach zero.

### 1.7 NFT membership & position cards
- Membership card = purchased tier artifact (`nft/membership/render.py`) with `pricePaidPerPeriod` snapshot.
- Position cards grant a *multiplicative* fee discount on top of tier + points.

### 1.8 Lattice Bridge (post-quantum settlement) — **pre-revenue**
`bot/services/bridge/lattice_api.py` is a quote-only dark scaffold, disabled by
default, never in `EXECUTABLE_PROVIDERS`, gated by `docs/pq-settlement-profile.md`.
Currently $0. It is, however, our single most defensible pricing asset —
see Part 3.

### 1.9 Other / unpriced
- Tempo gasless sponsorship (`tempo_fee_sponsor_enabled`) — we *pay* gas, charge nothing.
- MPP directory browse, `list_chains`, `list_tokens` — free.
- Across integrator id — attribution only, no fee.

---

## Part 2 — What the market actually charges

### 2.1 Consumer swap fees (Telegram bots)
Trojan, Maestro, BONKbot all sit at a **flat 1%** on every trade; market band is
0.5–1.5% with most charging no subscription. Maestro is the outlier that stacks
a monthly SaaS fee *on top of* 1%.

> **Implication:** our FREE tier at 1% is correctly priced — it is exactly at market.
> But our paid tiers *cut* the fee to 0.5 / 0.3 / 0.1%. We are the only player who
> both charges a subscription **and** discounts below market. Maestro proves you can
> charge 1% *and* a subscription. We give away ~90% of fee revenue on the top tier
> for $99.99/mo — that only breaks even above ~$11m/mo of that user's volume.

### 2.2 Perps builder fees (HyperLiquid)
- Protocol cap: **10 bps** on perps (100 bps on spot).
- Real market: frontends charge 0–10 bps; the widely-cited reference build is **5 bps**.
- >$40m in builder-code revenue paid out to date; ~40% of HL DAUs trade via third-party frontends.
- Worked market example: $10m daily volume @ 5 bps ≈ **$150k/mo**.

> **We charge 1 bp.** At the same $10m/day, that is $30k/mo instead of $150k/mo.
> Users already approved a 0.1% max rate — repricing to 5 bps needs no new consent flow.

### 2.3 Data / infrastructure API pricing (the real comp set for our Agent API)

| Provider | Entry paid | Mid | High self-serve | Notes |
|----------|-----------|-----|-----------------|-------|
| CoinGecko | **$35** (100k credits, 300 rpm) | **$129** (500k, 500 rpm) | **$499** (2M–15M credits, 500 rpm) | Enterprise = custom |
| Alchemy | ~$49 Growth | — | Enterprise custom | 30M CU free tier |
| QuickNode | ~$49 | — | Enterprise custom | |
| 1inch Business | Free Dev: 100k calls/mo @ **60 rpm** | Paid tiers | Enterprise w/ dedicated AM | Integrator fee is *separate* revenue |

> **The single most damning comparison:** CoinGecko charges **$499/mo for 500 rpm and
> a metered 2M credits**. We charge **$99.99/mo for 10,000 rpm and unlimited,
> unmetered calls** — 20x the rate limit, no metering, for 1/5 the price. And unlike
> CoinGecko we also carry execution risk, custody, RPC cost, and gas sponsorship.
>
> 1inch's *free* dev tier is 60 rpm. Ours is 30 rpm — but our $9.99 tier gives 500 rpm,
> which is CoinGecko's $499 tier.

### 2.4 Read-only vs. execution
No comp in the data-API set actually *executes* and *custodies*. Execution
platforms monetize on bps of volume, data platforms monetize on calls. **We do both
and charge like neither.** That is the core pricing error.

---

## Part 3 — Recommended pricing

### 3.0 The four principles
1. **Never discount the swap fee below market for a subscription.** Subscriptions buy
   *capability and capacity*, not cheaper execution. (Maestro's model, and it works.)
2. **Meter everyone.** Unlimited calls on paid tiers is the single biggest leak. Every
   comp meters. Give generous included credits, then overage.
3. **Enterprise is a conversation, not a checkout button.** Remove the $99.99 enterprise SKU.
4. **Price the moat.** Lattice/PQ settlement is not a cheaper bridge — it is a compliance
   product, and compliance products are priced per-settlement, not per-seat.

### 3.1 Consumer / Telegram ladder

| Tier | Now | **Proposed** | Swap fee now → **proposed** |
|------|-----|--------------|------------------------------|
| Free | $0 | $0 | 1.00% → **1.00%** (unchanged, at market) |
| Pro | $9.99 | **$19/mo** | 0.50% → **0.85%** |
| Premium | $29.99 | **$49/mo** | 0.30% → **0.65%** |
| Elite (was Enterprise) | $99.99 | **$149/mo** | 0.10% → **0.45%** |

Rationale: fee discount becomes a *perk*, not a giveaway. At 0.45% the top tier is
still the cheapest execution in the Telegram-bot category (market floor ~0.5%), but
break-even volume drops from ~$11m/mo to ~$27k/mo — i.e. the subscription is now
profitable on a *normal* user instead of only on a whale.

**Hard rule to add in code:** cap total stacked discount. Today
`tier_fee → −points_discount → ×(1 − positions_fraction)` can compound toward zero.
Introduce a **global floor of 0.25% (25 bps)** on the *final* effective fee, applied
after all stacking, in `fee_service.get_fee_decimal`.

### 3.2 Perps — immediate, no-consent-required repricing
`hl_builder_fee_tenths_bps: 10 → **50** (1 bp → 5 bps)`.
Within the already-approved `hl_builder_max_fee_rate = 0.1%`, at the market reference rate.
**This is the highest-ROI single-line change in this document.** ~5x perps revenue.

### 3.3 Agent API / MCP ladder (rebuilt against the real comp set)

| Tier | Now | **Proposed** | Rate limit | Included credits/mo | Overage |
|------|-----|--------------|-----------|---------------------|---------|
| Free | $0, 30 rpm, metered | $0 | 60 rpm | 10,000 | hard stop |
| **Build** | — | **$49/mo** | 300 rpm | 250,000 | $0.40/1k |
| Pro | $9.99, 500 rpm, unmetered | **$149/mo** | 600 rpm | 1,000,000 | $0.30/1k |
| Scale (was Premium) | $29.99, 2,000 rpm | **$499/mo** | 2,000 rpm | 5,000,000 | $0.20/1k |
| Enterprise | $99.99, 10,000 rpm | **From $2,500/mo, custom** | 10,000+ rpm | custom | committed-volume |

- Raise the free tier to 60 rpm to **match 1inch's free dev tier** — cheap goodwill, better funnel.
- Credit unit stays $0.001 nominal but **quote → 2 credits, execute → 10 credits**
  (execution costs us RPC, simulation, and risk; it should not be 5x a quote, it's ~10x).
- **Kill unmetered paid tiers.** Included-credits + overage is what every comp does.
- Enterprise gets: dedicated infra, SLA, custom fee splits, dedicated AM (1inch's model).

### 3.4 Agent-surface swap fees — make them tier-aware
Today the API charges a flat 30 bps (SOL) / 80 bps (EVM) regardless of what the
customer pays us monthly. Unify with the consumer logic:

| Agent tier | Swap fee (all routes) |
|-----------|----------------------|
| Free | 1.00% |
| Build | 0.85% |
| Pro | 0.65% |
| Scale | 0.45% |
| Enterprise | negotiated, floor 0.25% |

Also: **turn on `near_intents_fee_bps`** (currently 0) and set AVNU to the tier rate
rather than the 100 bps fallback. Routing volume we earn nothing on is pure loss.

### 3.5 Lattice Bridge — price the moat, not the bridge (pre-launch, do not ship until gates pass)
Post-quantum attested settlement is a **regulated-buyer** product (the `showcase/government`
surface exists for a reason). Do not price it as a bridge tier.

| SKU | Price | What it is |
|-----|-------|-----------|
| PQ Settlement — per transfer | **25 bps, floor $50/transfer** | attested ML-DSA-65 settlement receipt |
| PQ Gateway — dedicated | **$5,000/mo + 10 bps** | dedicated LTP gateway, custody attestation, audit export |
| Sovereign deployment | **$50k+/yr** | on-prem gateway, procurement contract |

Bridges compete on being cheap. Attested settlement competes on being *auditable* —
that buyer is price-insensitive and volume-light. A $50 floor per transfer is normal
in that market and catastrophic in the retail bridge market; keep the two SKUs separate.

### 3.6 Referral & points — stop the leak
- Referral share **30% → 20%** of collected fees, and apply it to the *tier* fee, never
  to the post-discount fee (today a discounted user yields a referral payout on an
  already-shrunken base — the leak compounds).
- Points redemption at **200 pts/$** is a hard USD liability. Move to **400 pts/$** and
  cap subscription redemption at **50% of one month's price** (points buy a discount,
  never a free month).
- Season referral cap 10,000 pts = $50 of liability per user at today's rate. At 400 pts/$
  that becomes $25 — keep the cap, halve the exposure.

### 3.7 Currently free, should not be
- **Tempo gasless sponsorship** — we pay gas and charge nothing. Gate it to Pro+ or
  fold the gas cost into a 10 bps surcharge on sponsored routes.
- **MPP directory listing** — a paid listing/placement SKU ($200–500/mo per listed agent)
  is the standard directory model and costs us nothing to serve.
- `list_chains` / `list_tokens` stay free. They are the funnel.

---

## Part 4 — Sequenced rollout

| # | Change | Effort | Revenue impact | Risk |
|---|--------|--------|----------------|------|
| 1 | `hl_builder_fee_tenths_bps` 10 → 50 | one line, one env var | **~5x perps rev** | none — within approved cap |
| 2 | Global 25 bps floor on stacked fee discounts | `fee_service.get_fee_decimal` | high | low |
| 3 | Enable `near_intents_fee_bps`, tier-ify AVNU | config + wiring | medium | low |
| 4 | Remove $99.99 self-serve enterprise → "Contact sales" | showcase + checkout | **raises ACV ceiling** | none |
| 5 | New Agent API ladder + metering on paid tiers | `constants.ts`, metering flag | **highest total** | needs grandfathering |
| 6 | Consumer tier reprice + fee-discount reduction | x402/TIER_LIMITS + bot copy | high | churn — grandfather existing |
| 7 | Referral 30→20%, points 200→400 pts/$ | points/seasons schema | medium | community sentiment |
| 8 | Lattice PQ SKUs | blocked on activation gates | new line | pre-revenue |

**Grandfathering:** existing paid users keep their current price and fee rate for 90 days
(`pricePaidPerPeriod` already snapshots this on the membership NFT — use it). New
signups get the new ladder immediately.

**Two changes (#1 and #2) are single-line, zero-consent, and should ship this week.**

---

## Sources
- [Best Telegram Trading Bots in 2026 — MEXC](https://www.mexc.com/news/1020872)
- [Telegram Trading Bots 2026 Guide — DEXTools](https://www.dextools.io/tutorials/telegram-trading-bots-2026-guide)
- [BonkBot Review 2026 — Coinspot](https://coinspot.io/en/telegram-trading-bots/bonkbot-solana-trading-bot/)
- [Hyperliquid Builder Codes — Dwellir](https://www.dwellir.com/blog/hyperliquid-builder-codes)
- [Hyperliquid Builder Fees Explained](https://hyperliquidguide.com/guides/trading/hyperliquid-builder-fees-explained)
- [CoinGecko API Pricing](https://www.coingecko.com/en/api/pricing)
- [1inch Business Portal](https://business.1inch.com/portal)
- [0x Swap API](https://0x.org/products/swap)
- [Best Crypto APIs 2026 — Hashlock](https://hashlock.com/blog/best-crypto-apis-for-web3-developers-2026)
