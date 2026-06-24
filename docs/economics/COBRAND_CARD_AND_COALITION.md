# Suwappu Co-Branded Card & Coalition Loyalty — Endgame Plan

> The endgame of the [[REWARDS_MARKETPLACE]]: points stop being a trading reward and
> become a **real-world loyalty currency** — earned on everyday spend (a card) and across
> partner apps (a coalition), redeemed in the marketplace. This is a strategy/design plan,
> not built. Capital-, licensing-, and partner-gated. Carries forward the two-balance and
> cash-equivalent guardrails from `REDEMPTION_AND_PARTNERS.md`.

## A. The card — earn points on everyday spend

A Suwappu card turns every coffee and grocery run into points, redeemable in the
marketplace. This is the single biggest "expand products" lever: it moves the program off
trading volume and onto consumer spend.

### Which card is realistic
- **Crypto debit / prepaid card (REALISTIC path).** Spend stablecoin/crypto balance, earn
  points/cashback. This is the Crypto.com / Coinbase One Card / Fold / Gemini model. You do
  **not** become a bank — you integrate a **card-issuing platform + BIN-sponsor bank** that
  holds the licenses: crypto-native issuers **Immersve, Rain, Baanx** (built for stablecoin
  spend), or general platforms **Marqeta / Lithic / Stripe Issuing / Highnote** + a crypto
  on/off-ramp. 6–12 months, capital + compliance, but no bank charter.
- **Co-branded CREDIT card (NOT realistic yet).** Needs a bank issuer + network + multi-year
  contract with **guaranteed annual minimums** and ~$150–200/account acquisition cost — these
  are billion-dollar relationships (issuers paid partners ~$22B in 2022) reserved for brands
  with large lists + strong affinity. Revisit only at major scale.

### Economics — interchange funds the rewards (self-funding spread)
- US interchange ≈ **1.79%** (credit) and, for **exempt/small-issuer or commercial-prepaid
  debit**, ≈ **1.6%** (regulated big-bank debit is capped near $0.21 + 0.05% under Durbin —
  which is why crypto cards run on prepaid/commercial BINs to capture higher interchange).
- Offer **1–2% back in points** on spend. Self-funding check (from the loyalty research):
  `interchange (≈1.6–1.79%) − points give-back (≈1%) − breakage-adjusted cost (points×(1−breakage))
  > 0`. With 20–30% breakage, 1% nominal give-back costs ≈ 0.7% → a positive spread before
  any marketing overhead. Tier it: stakers/PRO subscribers earn 1.5–2×.
- Points land in **`current_points`** (the spendable loyalty wallet) — **never** the
  token-convertible season balance (keep a payment product clear of securities entanglement).

### Compliance (the card is the heaviest reg surface in the whole program)
BSA/AML + KYC, state money-transmission, PCI-DSS, Reg E (debit) / Reg Z (credit), card-network
rules. **The BIN-sponsor / program manager holds most licenses** — that's the entire reason to
use one rather than build. Still need your own KYC/AML program + sanctions screening.

### Architecture hook
A `card_spend` earn source: the issuer/processor posts an **authorized-transaction webhook** →
`award_points(user_id, 'card_spend', amount = spend_usd × rate, metadata={mcc, merchant})`.
Same `award_points` funnel as trading. Redemption uses the existing marketplace.

## B. Coalition — earn & redeem across partners

A coalition lets points be earned/spent **outside** Suwappu (Bilt-alliance / Plenti model).
Two directions, very different lift:

### B1. Earn AT partners (REALISTIC MVP — a cashback-shopping layer)
Users shop at thousands of merchants *through* Suwappu and earn points, without signing each
merchant — via an **affiliate / cashback network**: **Wildfire, Button, Rakuten Advertising,
Impact**, or crypto-back networks **Lolli / Fold merchant network**. The affiliate commission
(~1–10% of sale) **funds the points**; you keep the spread. Implementation: a merchant catalog
+ affiliate postback webhook → `award_points(user_id, 'partner_shop', ...)` on confirmed sale.
This is the cleanest "expand products" coalition move — medium lift, no card, no enterprise BD.

### B2. Redeem AT / transfer TO partners (LONG-TERM, enterprise-gated)
Transferring Suwappu points into airline/hotel/other-program currencies runs through
**points.com / Plusgrade** (enterprise B2B, sales-gated, you must be/partner-with a loyalty
operator) — **not viable until the Suwappu currency has real scale.** Until then, the
marketplace's gift-card and travel tiers already deliver the *user-facing* "redeem for travel /
brands" experience without coalition contracts.

## C. Phased rollout (endgame sequence)
1. **Coalition earn via cashback-shopping network** (Wildfire/Button/Lolli) — shop → earn
   points. Medium lift, self-funding via affiliate commission, no card/charter. *Do this first.*
2. **Crypto debit card** via an issuing platform (Immersve/Rain/Marqeta) — earn points on
   everyday spend. High lift (capital + licensing + 6–12mo), but the transformational product.
3. **Co-brand credit card / airline-coalition transfer** — enterprise, large-scale only.

## D. Compliance & economics carried forward
- **Two-balance rule:** card- and partner-earned points → `current_points`, never the
  token-convertible season balance.
- **Self-funding math:** every earn source must have a revenue backing (interchange, affiliate
  commission, our own fees) ≥ points give-back × (1 − breakage). No unfunded emission.
- **Cash-equivalent redemptions** (gift cards/travel/cash) stay isolated, taxable, async,
  counsel-gated per `REDEMPTION_AND_PARTNERS.md`.
- **Card-specific:** BIN sponsor holds money-transmission/PCI; you run KYC/AML + sanctions.

## E. One-line thesis
Build the cashback-shopping coalition first (cheap, self-funding, expands "where you earn"),
then a stablecoin debit card (earn on real spend) — at which point Suwappu points are a genuine
consumer loyalty currency funded by interchange + affiliate spread + breakage, redeemable across
a real marketplace, with the speculative token leg kept cleanly separate.
