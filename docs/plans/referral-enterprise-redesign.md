# Enterprise Referral System — Benchmark & Redesign

**Status:** proposal · **Date:** 2026-08-25 · **Owner:** unassigned
**Scope:** `bot/services/referral_service.py`, `bot/models/referral.py`, `database/db.py`,
`bot/handlers/{start,swap,bulk_swap,referral}.py`, `api/webapp.py`, `api-ts/src/services/ReferralService.ts`

Grounded in the code as of `12b81f2` (post the verification/rebate/held-claim fixes), not in
design docs. Every "Suwappu today" claim below has a file anchor.

---

## 1. What the leaders actually do

| Dimension | Hyperliquid | Polymarket | dYdX | TG bots (Trojan / Bloom / Maestro) | Binance |
|---|---|---|---|---|---|
| L1 rate | up to 10% of fees | 10% of **net** fees | 30% of taker fees, sliding to 50% | 25–35% | tiered, negotiated |
| L2+ | — | 5% (indirect) | — | Bloom: L1 25% / L2 3%; Trojan runs 5 levels down to 1% | sub-affiliate |
| Referee incentive | 4% fee discount, first $25M volume | tier rebate | — | 1% → 0.9% fee | varies |
| Eligibility to earn | $10k lifetime volume | $10k lifetime volume | $10k lifetime volume | none | KYC + application |
| Attribution window | code at signup | **30 days** click→signup | code at signup | code at signup | cookie window |
| Commission duration | lifetime, capped at $1B/referral | **30 days** after signup, or until referee hits Platinum | lifetime | lifetime | lifetime |
| Volume tiering | — | — | 30-day trailing referred volume: <$1M 30%, $1–10M 40%, >$10M 50% | — | 30-day trailing |
| Payout | on-chain | **daily, midnight UTC, pUSD, auto** | **instant, automatic, on-chain USDC** | instant per-trade in SOL/ETH | monthly |
| Abuse policy | ToS | explicit: self-referral, linked accounts, inauthentic trading, omnibus wallets ineligible; **clawback reserved** | ToS | minimal | disqualify + revoke; quarterly performance review; KYC mandatory |

**The three structural patterns worth stealing:**

1. **Trailing-window volume tiers, not lifetime-cumulative** (dYdX, Binance). A referrer's rate
   reflects what they drive *now*. Lifetime-cumulative tiers only ratchet up and permanently
   inflate the fee share.
2. **Automatic, high-frequency, small payouts** (dYdX instant, Polymarket daily). Manual claim
   flows are a support burden and a trust problem; they also concentrate risk into large claims
   that then need manual review.
3. **Net-fee accounting** (Polymarket: "what Polymarket keeps after the referred user's own tier
   rebate"). Commission is a share of *retained* revenue, not gross — otherwise stacked discounts
   can drive the effective take-rate negative.

---

## 2. Where Suwappu stands

Fixed in `12b81f2`: `verify_referral()` had no caller (milestone stream dead), `bulk_swap.py`
never burned the referee rebate, and >$500 held claims had no operator resolution path.

Remaining gaps, ranked by severity:

### P0 — correctness / money

| # | Gap | Evidence | Why it matters |
|---|---|---|---|
| 1 | **No commission state machine.** `ReferralReward.is_paid` is a bool; `ReferralEarning` has no status column at all. | `bot/models/referral.py:110`, `:170` | Industry standard is `pending → held → approved → reversed`. With a bool there is no hold period, no qualification window, and no way to represent a reversal. |
| 2 | **No clawback path.** The ledger docstring says "negative rows represent clawbacks" but nothing in the codebase ever writes one. | `bot/models/referral.py:158`; `grep clawback` → 0 writers | A referee who wash-trades, reverses, or is later found to be a linked account keeps paying commission forever. Polymarket and Binance both reserve clawback explicitly. |
| 3 | **Gross-fee commission, stacked with the referee rebate.** `record_reward` takes `fee_amount_usd` as charged (already −10% from the rebate) and pays 30–40% of it. | `referral_service.py:357` | On a referred user's first 5 swaps Suwappu keeps `fee × 0.9 × 0.6` = 54% of list fee. Add a gas rebate or a points discount and the take-rate approaches zero. Nobody models the floor. |
| 4 | **Perps volume tier never decays.** `perps_volume_14d_usd` is a pure accumulator; the column name claims a 14-day window. | `referral_service.py:1088` (own TODO) | A referee who once traded big permanently pins their referrer at the 80% tier. This is a monotonic, irreversible giveaway of builder fees. |
| 5 | **Referrer tier is lifetime-cumulative referred volume** ($25k → power, $50k → elite), computed by a full `SUM` over all referees' swaps on every single reward write. | `referral_service.py:520` | Ratchets up, never down (contra dYdX's trailing 30 days), and is an O(all referred swaps) query on the swap hot path. |

### P1 — growth / competitiveness

| # | Gap | Evidence |
|---|---|---|
| 6 | **No L2 / indirect referrals.** Every serious competitor has at least two levels; Trojan has five. | `grep -i indirect bot/` → 0 hits |
| 7 | **No attribution window.** A code only attaches inside `/start` and only when `is_new_user` is true. Click today, sign up tomorrow without the deeplink → attribution lost forever. | `bot/handlers/start.py:256` |
| 8 | **No click tracking at all.** No record of a link being opened, so there is no funnel, no conversion rate, and no way to detect click fraud. | no `referral_clicks` table in `database/db.py` |
| 9 | **No campaign / vanity codes.** One auto-generated `USERNAME_XXXX` per user, no per-campaign codes, no partner-owned codes. | `referral_service.py:149` |
| 10 | **Manual claim, $1 floor, one chain.** vs dYdX instant and Polymarket daily-automatic. | `referral_service.py:655`, `CLAIM_PAYOUT_CHAIN = "base"` |

### P2 — enterprise hygiene

| # | Gap | Evidence |
|---|---|---|
| 11 | **Fraud surface is three static rules**: shared-wallet overlap, $10 min volume, $500/30d per-referee cap. No device/IP signal, no velocity check, no cohort behaviour, no sybil clustering. | `referral_service.py:250`, `:116-118` |
| 12 | **No partner-facing API or dashboard.** `api-ts/src/services/ReferralService.ts` is a stub — all three methods `Effect.fail('Not implemented')`. | `api-ts/src/services/ReferralService.ts:37` |
| 13 | **No reconciliation job.** `claim_rewards` explicitly leaves `processing` payout rows for "a reconciliation sweep" that does not exist. | `referral_service.py:770` comment |
| 14 | **Two ledgers kept in sync by hand.** `referral_rewards` (legacy, drives claims) and `referral_earnings` (multi-stream, drives display) are written in the same transaction with the same number — with no invariant test that they agree. | `referral_service.py:492-516` |
| 15 | **No audit log of state changes.** Operators cannot answer "why was this commission reversed" with a machine-readable reason. | — |

---

## 3. Target design

### 3.1 Commission state machine (fixes #1, #2, #13, #15)

Replace `is_paid: bool` with an explicit lifecycle on `referral_earnings`:

```
pending ──(qualification window elapsed, referee still good)──▶ approved ──▶ paid
   │                                                               │
   └──(fraud signal / referee disqualified)──▶ void            reversed
                                                                   ▲
                                              (clawback within 90d of approval)
```

- `pending` — credit recorded, not yet payable. Held for a **qualification window**.
- `approved` — window elapsed, included in claimable balance.
- `paid` — settled into custodial balance, `payout_id` stamped.
- `void` — never qualified (disqualified before approval). No money moved.
- `reversed` — clawed back after approval. Writes a **compensating negative row**, never mutates
  the original — the ledger stays append-only.

Recommended windows, adapting the forex-IB/prop-trading precedent to swap latency:
- **Swap stream:** 72h hold. Long enough for a failed/reverted tx to settle out, short enough to
  stay competitive with instant-payout rivals.
- **Perps stream:** 7 days. Matches position lifecycle; a position opened and closed to farm
  builder fees is visible within a week.
- **Milestone:** 14 days. Highest sybil value per dollar, so the slowest to approve.
- **Clawback window:** 90 days from approval, then final. Cap total clawback at 30% of the
  affiliate's trailing-90-day earnings so one bad referee cannot zero out honest work.

Every transition writes a `referral_earning_events` row: `(earning_id, from_state, to_state,
reason_code, actor, ts)`. `reason_code` is an enum, not free text — that is what makes the
partner-facing "why" machine-readable.

### 3.2 Attribution (fixes #7, #8, #9)

New table `referral_clicks`: `(code, click_id, telegram_id_hint, ip_hash, ua_hash, created_at)`.
Telegram deeplinks carry the code in `start`, so the click is only observable when the bot is
opened — but `/start` can still record the click *before* the user-creation branch, which
decouples "clicked" from "converted".

- **30-day attribution window** (Polymarket's number). A `/start` with a code creates a pending
  attribution; if the user later completes signup within 30 days, it binds.
- **First-touch wins** on conflict, which is what the current unique constraint on
  `referrals.referee_id` already implies — make it explicit rather than incidental.
- **Campaign codes:** promote `ReferralCode` from one-per-user to many-per-user with
  `(user_id, code, label, is_default)`. Partner and campaign codes then need no new concept.

Funnel metrics fall out for free: clicks → starts → signups → first swap → qualified.

### 3.3 Multi-level (fixes #6)

Two levels, matching Polymarket's shape rather than Trojan's five (five levels is a pyramid
optics problem and a support-load problem for marginal revenue):

- L1: current tiered 30% / 40%.
- L2: 5% of net fees, paid to the referrer's referrer.

Requires a `referrer_path` materialisation or a recursive CTE — with a hard depth cap of 2 and a
cycle guard, since `referrals` is user-supplied edges.

**Combined take-rate must be modelled before this ships.** L1 40% + L2 5% + a 10% referee rebate
leaves 51% of list fee. That may be correct — it is a growth lever — but it must be a decision,
not an emergent property.

### 3.4 Trailing-window tiers (fixes #4, #5)

Replace both accumulators with a nightly-recomputed 30-day trailing aggregate, stored
denormalised on `referral_codes` with a `tier_computed_at` stamp:

| Trailing 30d referred volume | L1 rate |
|---|---|
| < $1M | 30% |
| $1M – $10M | 40% |
| > $10M | 50% |

This is dYdX's ladder. It fixes the ratchet, kills the O(all-swaps) SUM on the hot path, and
makes the perps 14-day window mean what its column name says. Tier changes are logged, and a
tier can go **down** — which needs to be communicated in the UI or it will generate support load.

### 3.5 Fraud detection (fixes #11)

Layer the existing static rules into a scored model with encoded escalation, per the operator
playbook — thresholds calibrated against 2–4 weeks of real baseline before enforcement:

| Signal | Source | Action band |
|---|---|---|
| Shared wallet address | existing check, `referral_service.py:250` | hard block (keep) |
| Shared device / IP cluster | new: hash at `/start`, cluster nightly | review → hold |
| Referee volume concentrated in one token round-trip | `swap_transactions` cohort query | hold |
| Time-to-first-swap < 60s across a referrer's cohort | behavioural cohort | review |
| Referrer's cohort qualification rate ≫ platform baseline | weekly cohort review | review |
| Referee funded from referrer's wallet | on-chain, Blockscout | hard block |

Three bands, encoded in the platform not enforced by hand: **review** (flag, keep paying),
**hold** (earnings stay `pending` past their window), **terminate** (void + clawback). The
playbook's own guidance is that pre-payout holds beat post-payout clawbacks — which is exactly
what the state machine in §3.1 buys.

### 3.6 Payouts (fixes #10, #13)

- **Automatic daily sweep** of `approved` earnings into custodial balance, replacing the manual
  claim as the default. Keep manual claim as an on-demand path.
- Drop the $1 floor for the automatic path — daily accrual of any size, which is what Polymarket
  does. Keep a floor only for on-chain withdrawal, where gas actually matters.
- **Reconciliation job** that finds `processing` payouts older than 15 minutes and retries or
  fails them. The code already assumes this exists; it does not.
- Multi-chain payout, since Suwappu is a cross-chain product and paying only on Base is an odd
  constraint for a referrer who lives on another chain.

### 3.7 Partner surface (fixes #12, #14)

- Implement `api-ts/src/services/ReferralService.ts` against the same tables — or, better, have
  it proxy the Python service so there is one source of truth rather than two drifting ones.
- Partner dashboard fields, per the transparency standard: real-time per-earning state with
  timestamps, machine-readable clawback reasons, full state-change log.
- **Invariant test in CI:** for every referral, `sum(referral_rewards.reward_amount_usd)` equals
  `sum(referral_earnings.amount_usd WHERE stream_type='swap')`. The two ledgers are currently
  kept in agreement by two adjacent `session.add` calls and nothing else.

---

## 4. Phasing

| Phase | Contents | Unblocks |
|---|---|---|
| **1 — Ledger integrity** | State machine (§3.1), event log, clawback writer, reconciliation job, dual-ledger invariant test | Everything else. Do not build growth features on a ledger that cannot represent a reversal. |
| **2 — Economics correctness** | Net-fee accounting (#3), trailing-window tiers (§3.4), perps decay, modelled take-rate floor | Stops the monotonic giveaway |
| **3 — Attribution** | Click table, 30-day window, campaign/vanity codes, funnel metrics | Makes growth measurable |
| **4 — Growth** | L2 commissions, automatic daily payouts, multi-chain payout | Competitive parity |
| **5 — Trust & scale** | Scored fraud model, partner API + dashboard, audit export | Enterprise-ready |

Phases 1 and 2 are corrective and should ship regardless of whether the growth work is funded.

---

## 5. Decisions needed before Phase 2

These change the economics and are not mine to make:

1. **Target take-rate floor.** What is the minimum fraction of list fee Suwappu keeps after every
   stacked discount (referee rebate + L1 + L2 + gas rebate + points)? Everything in §3.3 and §3.4
   is calibrated against this number and it does not exist yet.
2. **Net vs gross fee basis.** Polymarket pays on net. Suwappu currently pays on gross-after-rebate.
   Switching to net is a rate cut for existing referrers and needs a comms plan.
3. **Lifetime vs windowed commission duration.** Hyperliquid and dYdX pay lifetime; Polymarket
   caps at 30 days post-signup. Suwappu is lifetime today. Lifetime is the more attractive offer
   and the larger liability.
4. **Can a referrer's tier go down?** Trailing windows imply yes. Product call.
5. **Is a tier-down or a clawback a notification event?** Affects support load either way.
