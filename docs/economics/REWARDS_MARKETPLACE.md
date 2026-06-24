# Suwappu Rewards Marketplace — Product Expansion Blueprint

> The thesis: stop treating points as "a swap gimmick" and build **Suwappu's rewards
> program** — a loyalty currency that EARNS across the whole product line and REDEEMS
> into a real, mainstream marketplace (gift cards, travel, merch, donations), with
> crypto as one rail among many, not the only rail. Pairs with `SEASONS_TOKENOMICS.md`
> (the token leg) and `REDEMPTION_AND_PARTNERS.md` (the compliance guardrails).

## 0. Where we are today (audit, Jun 2026)
- **Earn:** only **swaps** (+ check-in, referral, milestones) award points. Wired.
- **Convertible:** season points → SUWP pro-rata (fee-based, disinflationary). Wired.
- **Referral:** 30% of referee fees → referrer USDC on Base. Wired, atomic.
- **Staking:** pts→SUWP claim + weekly epoch fee-share (USDC via Superfluid). Core wired.
- **Redeem:** subscriptions fulfill (atomic). fee_discount/gas_rebate/raffle are
  recorded-but-inert. Cash-equivalent/partner = blocked.
- **Gaps:** perps, predictions, P2P, deposits/holding, LP, copy-trade earn NOTHING.
  The redemption catalog is one product deep.

## 1. Architecture — a pluggable provider + async order model

Today's `rewards` table + hardcoded redeem-handler effects don't scale to many product
types. Introduce two primitives:

**`reward_category`** on every catalog item, routed to a **RewardProvider** that fulfills it:

| Category | Provider | Fulfillment | Reg posture |
|---|---|---|---|
| `own_product` | internal grant | instant (subscription, fee-credit, limits, features) | SAFE — loyalty rebate |
| `gift_card` | aggregator (Tremendous/Tango/Giftbit/Runa fiat · Bitrefill crypto) | **async** (provider API) | cash-equivalent → isolate, taxable, counsel |
| `travel` | Duffel (no IATA) · Travala (crypto/x402) | async (booking) | cash-equivalent → isolate, taxable |
| `merch` | Printful POD · Ledger hardware | async (ship) | goods → lower risk; sales-tax/shipping |
| `donation` | The Giving Block / Endaoment | async | low-risk, strong brand |
| `crypto` | internal (SUWP/USDC) | on-chain | the token leg — keep separate |
| `experience` | internal | instant (raffle, sweepstakes, whitelist) | promo |

**`redemption_orders`** — the new money-path table for ASYNC fulfillment (gift cards,
travel, merch don't grant instantly like subscriptions): `userId, rewardId, category,
pointsSpent, status (pending|fulfilled|failed|refunded), providerRef, payload,
idempotencyKey, createdAt, fulfilledAt`. Pattern: **debit points → create order
(pending) → call provider → fulfilled | refund points on failure.** Mirrors the existing
referral-claim atomic-with-refund pattern; the subscription grant stays instant (own_product).

A `RewardProvider` interface: `quote(item) · fulfill(order) -> {providerRef, status} ·
status(order)`. New products = new provider, not a rewrite.

## 2. Redeem-side expansion — the marketplace (mainstream-first)

Ranked by lift × value × risk. **Lead with own-product (Tier 0); the flagship
"non-crypto" win is Tier 1 mainstream gift cards.**

**Tier 0 — Own product (build now, zero new reg surface, non-taxable):**
- Subscriptions ✅ (done) · **fee-credit / rebate vouchers** (wire fee_discount to actually
  apply — Binance-style; cheapest sink, marginal cost ≈ 0) · perp/P2P fee discounts ·
  gas-credit (tie to Tempo/paymaster budget) · higher rate limits / API quota · priority
  support · premium features · early-access / whitelist spots.

**Tier 1 — Mainstream gift cards & prepaid (THE expansion):**
- Catalog via **Tremendous / Tango / Giftbit** (fiat, zero platform fee, pay face) or
  **Bitrefill** (crypto-funded from treasury): Amazon, Visa/Mastercard prepaid, Starbucks,
  Target, DoorDash, **Netflix, Spotify, Disney+** (third-party subscriptions), etc.
- Cash-equivalent → Bucket-1 only, taxable redemption, async order, counsel/MTL sign-off.

**Tier 2 — Travel:** flights/hotels via **Duffel** (no IATA, set markup) or **Travala**
(crypto/x402, overlaps our Base stack). "Redeem points for travel credit."

**Tier 3 — Physical merch & hardware:** Suwappu swag (Printful POD) · **Ledger hardware
wallets** (natural — we already integrate Ledger) · books. Real COGS + shipping/tax.

**Tier 4 — Donations:** crypto-philanthropy (The Giving Block) — donate points to charity.
Low-risk, clean tax story, brand/PR win, breakage-friendly.

**Tier 5 — Experiences / sweepstakes:** wire the existing **raffle** · mystery boxes
(Crypto.com model, house-set EV) · event tickets · NFT/whitelist.

**Tier 6 — Statement credit / cash-out (HIGH risk, defer):** USDC cashback from a
**fee-funded, capped** pool only. Money-transmission/stored-value exposure.

**Tier 7 — Coalition / co-brand (long-term, enterprise):** transfer points to airline/
hotel programs (points.com/Plusgrade — enterprise-gated) · a **co-branded card**.

## 3. Earn-side expansion — reward the WHOLE product, not just swaps

Every Suwappu product should mint points. Biggest gaps first:

- **Perps** (fee-based, like swaps) — terminal/HL is a flagship; earns 0 today. *Highest value.*
- **Prediction markets** (Polymarket) — volume + correct-prediction bonus.
- **P2P** trades — fee-based points.
- **Deposits / fiat on-ramp** — first-deposit bonus + on-ramp incentive.
- **Holding / HODL** — time-weighted balance points ("park assets, earn") — a savings product.
- **Staking / LP** — loyalty multiplier on season points for stakers/LPs (reward conviction).
- **Copy-trade** — wire the recorded-but-inert `copy_trade`/`get_copied` (no call-site today).
- **Social / quests** — verified X connect, KYC, profile completion, community.
- **Card spend (endgame)** — a Suwappu debit/credit card earning points on EVERYDAY spend,
  redeemable in the marketplace. This is the true "expand products" play: points stop being
  a trading reward and become a real-world loyalty currency.

Keep the season funnel's anti-farm posture: fee/cost-denominated where possible, daily caps,
allowlist. New earn sources plug into the same `award_points` + season-accrual funnel.

## 4. The strategic arc
1. **Now:** own-product redemptions (fee-credit) + wire the top earn gaps (perps, copy-trade).
2. **Next:** the marketplace backbone (provider + `redemption_orders`) + Tier-1 mainstream
   gift cards via an aggregator — the headline "redeem points for Amazon/Visa/Netflix" launch.
3. **Then:** travel, merch (Ledger), donations.
4. **Endgame:** co-branded card (earn on real spend) + coalition partners → points become
   *the* Suwappu rewards program and a retention moat, not a swap gimmick.

## 5. Compliance carried forward (non-negotiable)
- **Two-balance rule:** redemptions spend `current_points`; NEVER burn the token-convertible
  season balance (Howey optics).
- **Cash-equivalent (gift cards / travel / cash) = isolated, taxable, async, counsel-gated**;
  own-product redemptions are the safe core — lead with them.
- **ASC 606 / IFRS 15 liability + breakage** accounting as the catalog grows
  (liability ≈ outstanding_points × face × redemption_rate; breakage is the funding lever).
- Pricing anchored at `REDEMPTION_POINTS_PER_USD` (0.5¢/pt) — below a point's implied token
  value so holding-for-TGE still competes with spending.
