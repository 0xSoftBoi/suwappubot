# Suwappu Points Redemption — Subscriptions, Partners & the Two-Balance Rule

> Committed design + compliance guardrails for redeeming loyalty points. Pairs with
> `SEASONS_TOKENOMICS.md`. **Not legal/tax advice** — the flagged items must go to
> counsel and the auditor before the partner/cash-equivalent leg ships. Research
> synthesis dated 2026-06-23 (primary sources: 31 CFR, FinCEN, CSBS MTMA, SEC release
> 33-11412 (2026-03-17), IRS Rev. Rul. 2019-24 / Anikeev / Ann. 2002-18, IFRS 15 IE52).

## The one rule that governs everything: SPLIT THE TWO BALANCES

Suwappu has two point balances that must **never be fused**:

| | **Bucket 1 — `current_points` (loyalty wallet)** | **Bucket 2 — season points (token-convertible)** |
|---|---|---|
| Earned | via activity (swaps, check-in, referrals) | via fee-paying activity (see tokenomics) |
| Redeemable for | **Suwappu's OWN goods**: subscriptions, fee discounts, plan upgrades | nothing — it only converts to SUWP pro-rata at TGE |
| Transferable / cash-out | **No** | No |
| Regulatory posture | **Loyalty/rebate carve-out** (FinCEN prepaid-access exclusion, CSBS MTMA issuer-only exemption, MiCA Recital 17). Non-taxable rebate. | Securities (Howey) leg — handled separately under counsel; taxable airdrop at FMV at TGE |

**Subscription redemption spends Bucket 1 only and never touches Bucket 2.** This is the
single most important compliance decision and it is now enforced in code
(`points_service.redeem_subscription_reward` / `PointsService.redeemReward`).

### Why the split is non-negotiable (the trip-wires)
A loyalty balance stays inside every carve-out **only if** it is: earned-only
(non-purchasable), non-transferable, no cash-out, redeemable only for the issuer's own
goods. Four things break it — each individually:
1. Points **bought for cash** → money-transmission / stored-value.
2. Points **redeemed for cash or cash-equivalents (gift cards, airline miles)** → breaks
   the FinCEN/MTMA exemption AND the tax rebate shield (the *Anikeev* cash-equivalent line
   → user owes income tax, possible 1099).
3. Points **transferable to third parties for value** → transmission + MiCA scope + a
   secondary market (the EIGEN-style P2P failure).
4. **Marketing points around a future token / TGE / "your allocation"** → supplies the
   Howey profit-expectation prong (post-2026 SEC release; a non-security token *becomes*
   a security when promoted this way).

### The single most important DON'T
**Do NOT make any redemption burn the token-convertible (Bucket 2) balance.** Burn-as-
buyback reads as a profit distribution to capital holders → the *worst* Howey optics, and
it fuses the clean loyalty leg with the speculative leg. Redemptions draw Bucket 1, which
has no token-supply effect. (This reverses an earlier "burn season points for premium
redemptions" idea — it is explicitly rejected.)

## Why redemption is economically powerful (the upside that justifies it)
- **Velocity sink.** Redeeming points for a subscription competes with the *sell* decision
  at exactly the moment sell-pressure peaks (unlock/TGE). Lower velocity ⇒ higher token
  value (MV=PQ).
- **Utility / arbitrage floor.** If 1 point reliably redeems for $X of subscription, the
  token form can't durably trade below $X — rational holders redeem for utility instead of
  dumping. This is the stablecoin peg mechanism, and it is **only as strong as redemption
  stays open, honored, and uncapped.**
- **Points-fatigue hedge.** The EIGEN "points are dead" episode showed points are a
  *discretionary* promise. A point that **also redeems today for real product value**
  keeps a non-discretionary floor even if the token underperforms at TGE. This is the
  strongest single argument for the whole redemption feature.

## Redemption pricing
`REDEMPTION_POINTS_PER_USD = 200` → 1 point ≈ $0.005 (0.5¢), deliberately conservative vs
the ~1¢/point loyalty-industry baseline (TPG/NerdWallet: airline miles 1.2–1.6¢, transferable
bank points ~2¢; cash/gift-card baseline ~1¢; miles cost airlines only ~0.72¢ to *produce*).
Subscription `points_cost = round(monthly_price_usd × 200)`:
- 1 Month PRO ($9.99) → **2,000 pts** · PREMIUM ($29.99) → **6,000 pts** · ENTERPRISE ($99.99) → **20,000 pts**

### Accounting (ASC 606 / IFRS 15)
Outstanding `current_points` are a **contract liability** ≈ `outstanding_points × face_value ×
expected_redemption_rate`. Recognize **breakage** in proportion to the redemption pattern
(loyalty redemption rates typically run 15–30%, so breakage — not face value — is what makes
a generous headline rate affordable). Disclose the breakage/redemption-rate judgment.

## Partner / airline programs — phased, guardrailed, NOT live

Direct cash-equivalent redemption (airline miles, gift cards) is the **riskiest** item and
is deliberately **NOT enabled**. Recommended rollout, safest → riskiest:

1. **Now (safe, own-product):** subscriptions ✅ (shipped). Next: wire the existing
   `fee_discount` reward to actually apply at swap time — a BNB-style "spend points for
   trading-fee discount" sink. Pure own-product, best-precedented (Binance BNB 25% fee
   discount), no new regulatory surface. *(Recommended next build.)*
2. **Later (isolated, counsel-gated):** gift-card / travel-credit via an aggregator
   (Tremendous / Tango / Bitrefill). This crosses the cash-equivalent line → treat as a
   **taxable** redemption (possible 1099), isolate from Bucket 2, and obtain MTL/stored-value
   sign-off. Microsoft *pulled* direct subscription redemption and indirected through gift
   cards for exactly these cost/abuse reasons — understand that before committing.
3. **Eventually (hardest):** a direct airline/coalition partner (Bilt-style transfer at a
   fixed ratio, e.g. points → miles). Requires a signed partner, you procure miles at
   wholesale (~1–2¢/mile), and full legal review. High lift; do last.

**Code posture:** the partner-redemption path is scaffolded (data model + adapter
interface) but **disabled by default** and returns "not available — partner integration +
compliance sign-off required." It never performs a live transfer. This mirrors the TGE
claim 425-stub: code-ready, not falsely "live."

## Guardrail checklist (enforced + to-enforce)
- ✅ Subscriptions/fee-discounts redeem **Bucket 1 only**, for **Suwappu's own product**.
- ✅ No redemption burns Bucket 2 (token-convertible).
- ✅ Points are earned-only, non-transferable, no cash-out.
- ⛔ No cash-equivalent (miles/gift-card) redemption until isolated + counsel-signed + taxable-treatment wired.
- ⛔ Don't market points as "your token allocation / guaranteed pro-rata profit."
- ☐ Stand up ASC 606 liability accounting + breakage estimate.
- ☐ 1099-MISC for taxable no-spend/referral bonuses ≥ threshold; 1099-DA if custodying token secondary trades.
- ☐ State-by-state MTL review (MTMA adoption is non-uniform); EU: keep the token non-fiat-pegged to avoid e-money-token/EMI.
