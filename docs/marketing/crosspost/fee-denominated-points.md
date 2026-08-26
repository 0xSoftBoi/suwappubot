---
title: "Why we denominate loyalty points in fees paid, not volume traded"
audience: tokenomics/mechanism-design audience, points-program operators, stablecoin/fintech loyalty teams
status: draft
topic_status: committed economic design, PRE-TGE. No token exists yet; season 1 window is Jul 1 - Oct 1 2026 per the schedule. This is a design/mechanism piece, not a live-product announcement.
---

## Sources (every number below is traceable)

- `docs/economics/SEASONS_TOKENOMICS.md` — full model, constants table (§4), reference implementation (§5)
- Constants cited: `SEASON_POINTS_PER_FEE_USD = 100`, program allocation `A` = 30% of 1,000,000,000 max supply, `N = 8` seasons, decay `δ = 0.75`, revenue cap `γ = 2.0`, vesting 40% at claim / 60% over 2 seasons, daily engagement cap 5,000 pts/user/day, referral cap 10,000 pts/season
- Theory citations already in the source doc: Tullock 1980; Kydland–Prescott 1977; Friedman's k-percent rule; empirical comparisons to Hyperliquid, Jito, Curve, Blast, friend.tech (SEASONS_TOKENOMICS.md §1.1–1.2, §6)

---

## A. Long-form (blog / Mirror)

**Title: Every points program is a rent-seeking contest. The only design choice is where the rent goes.**

Points-for-airdrop programs have a well-known failure mode: give away a fixed pool proportional to activity, and rational, free-entering farmers will burn resources chasing it until the pool is almost entirely dissipated. This isn't a bug specific to any one protocol — it's the textbook Tullock contest result. With `n` farmers and linear cost `c` per unit of "effort" (points), the equilibrium fraction of the pool competed away is `(n-1)/n`: 50% dissipated at just 2 competitors, 90% at 10, 99% at 100, approaching 100% as `n` grows. Raising minimum trade size or adding daily caps doesn't change that fraction — it only changes how much total effort gets spent chasing it. Caps are hygiene, not a fix.

The one lever that actually matters is where the dissipated cost flows. Decompose the cost of a farmed point into `c_external` (gas, bridge fees, wash-trade slippage — money that leaves the system entirely) and `c_protocol` (fees paid to the protocol itself to earn the point). If points are denominated in raw volume, farming mostly generates `c_external` — pure deadweight loss, visible in the sector as Blast's launch-day crash to roughly $0.02 and −97% TVL, or friend.tech's token falling roughly 98%: real activity whose cost left the system with nothing recouped.

If points are instead denominated in fees actually paid to the protocol, the dissipated rent becomes protocol revenue, converging toward the full contest value as farming intensifies: `R = c_protocol · S* → V`. A useful side effect is that Sybil-splitting stops mattering economically — 100 fake wallets paying the same aggregate fees as one real whale earn the same points at the same total cost, so detection becomes optional rather than load-bearing. Hyperliquid is the closest live comparison: points earned via fee-paying perps volume, token appreciated post-launch, rather than the points-drove-a-crash pattern seen elsewhere.

That's why Suwappu's season points formula is `points = 100 × fee_paid_usd × multiplier` — fee-denominated, not volume-denominated — with small, separately capped bonuses for check-ins, streaks, and referrals so the program's value stays fee-backed in aggregate (5,000 pts/user/day engagement cap, 10,000 pts/season referral cap).

The other half of the design handles inflation *across* seasons rather than within one: a single season pool has no internal nominal inflation (it's just proportional shares), but a sequence of pools dilutes the circulating supply over time unless the schedule is pre-committed to decay. We use a finite-N geometric schedule — 8 seasons, 30% of a 1B max supply allocated to the whole program, each season's pool 75% of the prior one's — so season-over-season inflation falls from 75% at season 2 to under 4% by season 8, the same mechanism family as Bitcoin's halving or Curve's roughly −16%/year emission decay, just tuned to our own parameters. A revenue cap (`γ = 2.0`: never emit more than 2x a season's realized fee revenue, applied at settlement) throttles emission in weak seasons so supply growth doesn't outrun demand — explicitly the lesson several 2023–2025 points programs learned the hard way.

We're stating plainly what this is and isn't: this is a committed design — a "monetary constitution" meant to be changed only by deliberate, announced governance action, not silently — for a token and seasons program that has not launched. No token exists yet. Season 1 is scheduled Jul 1 – Oct 1, 2026. This is mechanism design, published before launch specifically so the commitment is checkable against what ships.

## B. X/Twitter thread

1/ Every points-for-airdrop program is a rent-seeking contest, whether the designers know it or not. The only real design choice is where the dissipated value goes. Here's the math we used to decide. 🧵

2/ Tullock contest result: with n free-entering farmers, the fraction of a fixed pool competed away in equilibrium is (n-1)/n. 50% at n=2. 90% at n=10. 99% at n=100. Caps on trade size don't change this fraction — only the total effort spent.

3/ So the lever isn't "stop farming" (you can't) — it's where farming's cost lands. Volume-denominated points burn cost externally (gas, slippage to third parties): pure deadweight. See Blast (~-97% TVL) and friend.tech (~-98% token) post-points.

4/ Fee-denominated points route that same dissipated cost into protocol revenue instead: R = c_protocol · farmed_points → protocol treasury. Side effect: 100 Sybil wallets paying the same total fees as 1 whale earn the same points at the same cost — Sybil detection becomes optional.

5/ Our formula: points = 100 × fee_paid_usd × multiplier. Fee-denominated, not volume-denominated. (`SEASON_POINTS_PER_FEE_USD = 100`, docs/economics/SEASONS_TOKENOMICS.md)

6/ Cross-season inflation is the other half: 8 seasons, 30% of a 1B max supply, each pool 75% of the prior one. Season-over-season inflation: 75% → 32% → 18% → ... → under 4% by season 8. Same family as Bitcoin's halving, tuned differently.

7/ Revenue cap: never emit more than 2x a season's realized fee revenue (γ=2.0), applied at settlement — so emission can't outrun demand. This is design, not launch news: no token exists yet, season 1 runs Jul 1 - Oct 1 2026. Publishing the constitution before the token, on purpose.

## C. LinkedIn

**Every points program is a Tullock contest. We designed ours to route the dissipation into revenue instead of deadweight loss.**

The economics of "earn points, convert to token pro-rata" programs are well understood and mostly ignored: with free entry and linear cost, rational farmers compete away most of a fixed pool regardless of caps — 50% at just two competitors, approaching 100% as the field grows. Raising minimum trade sizes changes how much gets spent chasing the pool, not the fraction lost to competition. That's the textbook Tullock result, and it explains a lot of 2023–2025 points-program crashes better than "the token just didn't have a use case."

The design choice that actually matters is where the competed-away value goes. If points are denominated in raw trading volume, the dissipated cost is mostly external — gas, bridge fees, slippage paid to third parties — pure deadweight loss. If points are denominated in fees paid to the protocol instead, that same dissipated cost becomes protocol revenue, and Sybil-splitting stops being an economic problem: fake wallets paying the same aggregate fees as one real user earn the same points at the same cost.

That's the reasoning behind Suwappu's season points formula — fee-denominated, not volume-denominated — paired with a pre-committed, disinflationary, finite-schedule emission across seasons (8 seasons, decaying 75% per season, capped at 2x realized fee revenue) so supply growth can't outrun actual usage.

To be direct about status: this is committed mechanism design for a token and seasons program that has not launched — no token exists yet, and the first season is scheduled for Jul 1 – Oct 1, 2026. We're publishing the constitution ahead of the token specifically so the commitment is auditable against what actually ships.

## D. SEO title/description

- **Title:** Fee-Denominated Points: Designing a Self-Funding, Sybil-Neutral Airdrop
- **Description:** A Tullock-contest analysis of points-for-airdrop programs and why Suwappu denominates season points in protocol fees paid, not trading volume — with a pre-committed, disinflationary 8-season emission schedule.

## What we deliberately did not claim

- Did not present this as a live token or an active airdrop — explicitly labeled "committed design, pre-TGE" in the header and body of every version, because no token has launched.
- Did not claim the Tullock/rent-dissipation model is empirically proven for crypto points programs specifically — the source doc itself flags "no rigorous study quantifying earned vs social allowlists was found... directionally supported, not proven" for an adjacent claim, and this piece keeps the same caution about the broader model.
- Did not state a specific token ticker, exchange listing, or price expectation — none exists in the source doc, and doing so would risk implying investment upside.
- Did not claim the emission schedule is immutable — the source doc calls it a "monetary constitution" changeable only by deliberate, announced governance action, which is a different (weaker) claim than "cannot change."
