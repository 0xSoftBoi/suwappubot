# Points Programs Are Tullock Contests

**Equilibrium participation, dissipation, and the denomination lever**

Tsolmondorj Natsagdorj (0xSoftBoi), Suwappu Research
26 July 2026

*A closed-form equilibrium model of pro-rata token-points programs, with Monte Carlo sampling distributions, and what it implies for anyone designing or diligencing one.*

---

## Executive summary

- **A pro-rata points pool is captured by single-digit-to-low-teens numbers of operators, not by a user base.** With 5,000 potential entrants, no fixed cost of entry, and lognormal cost dispersion σ from 0.2 to 1.0, the median Nash-equilibrium active set falls from 18 to 5. Across 500 draws per σ the 5th-to-95th-percentile range runs 12 to 24 at σ = 0.2 and 3 to 8 at σ = 1.0. All four summary measures are monotone in σ: concentration tightens as dispersion widens.

- **The part of the pool that is not competed away is operator profit, not protocol savings.** Median farmer surplus rises from 9.5% of the entire pool at σ = 0.2 to 29.8% at σ = 1.0, with a 95th percentile of 50.9%. The single largest operator takes a median 17.1% of the pool at σ = 0.2 and 40.8% at σ = 1.0, with a 95th percentile of 66.0%.

- **Caps and minimum trade sizes do not reduce the fraction of the pool competed away.** Symmetric dissipation is exactly *D*(*n*) = (*n*−1)/*n*, an expression containing no cost term. Sweeping unit cost over a 1,000× range at *n* = 100 leaves dissipation at 0.990 throughout: points minted fall from 9.9 million at $0.10 per point to 9,900 at $100, while dollars burned stay at $990k.

- **Denomination is the only lever that relocates value.** At *n* = 100 on a $1m pool, all four designs tested burn $990k. Protocol capture ranges from $49.5k (5.0% of the pool) under volume denomination to $960k (96.0%) under near-total fee denomination.

- **Fee-proportional points are sybil-neutral by construction; the standard anti-sybil device is what creates the sybil incentive.** Splitting a fixed budget across *k* = 1 to 1,000 wallets moves pool share by exactly zero at every competing-effort level tested, from 100,000 to 20,000,000 points; at 1,000,000 competing points a $100k budget holds 0.091 of the pool whether it sits in one wallet or a thousand. A 25% bonus on the first 5,000 points *per wallet* makes splitting pay by 1.104× to 1.233× over that same range.

- **No number here is calibrated against an observed points program.** The model is falsifiable on a public variable, the top-10 share of allocated supply at completed points-to-airdrop programs, and we have not run that test. What follows is the equilibrium of a stated game and the design implications it carries: theory with sampling bands, not measurement.

---

## Why this matters

The pitch for a points program is that it converts usage into ownership: thousands of users earn, the pool splits proportionally, and the token base ends up wide. The mechanism as written down does not produce that. A pro-rata split of a fixed pool by share of accumulated points is, exactly and not by analogy, a Tullock proportional contest, and under realistic cost heterogeneity its equilibrium concentrates. A handful of operators with the lowest marginal cost per point crowd everyone else to zero effort, without cheating, without fixed entry costs, and without any sybil behavior. Concentration is the equilibrium, not the failure mode.

For an investor diligencing a token distribution, this reframes the question. Wallet counts and points-holder counts describe who showed up, not who gets paid. Two numbers predict the outcome: the dispersion of marginal cost per point across participants, and the share of the pool sitting in the top ten point balances. The second follows from the first, and a program built on continuous, uncapped, linear-cost accumulation should be underwritten as an allocation to roughly ten counterparties and priced accordingly.

For policy staff, the retail-participation framing needs the same correction: participation here is real in headcount and close to irrelevant in allocation. The design responses that read as protective, including per-wallet floors, first-*N*-points bonuses, and minimum trade sizes, either leave concentration untouched or actively manufacture the incentive to split wallets. The one intervention that changes anything is denomination, and its limit is narrow: it moves dissipated value out of third-party gas and slippage and into protocol revenue, without widening the set of people who capture the pool.

---

## 1. The contest structure and its literature

A large share of token-distribution mechanisms shipped since 2022 convert accumulated activity into a pro-rata share of a fixed pool at a future token-generation event. If Pool dollars are split in proportion to points earned, and points cost something real to acquire (gas, capital lockup, slippage, or protocol fees), the payoff facing each user is the Tullock (1980) lottery contest payoff, and the equilibrium behavior of the program is the equilibrium behavior of a rent-seeking contest.

Two standard intuitions fail as a result. Caps are held to limit dissipation; Proposition 2 shows the dissipated fraction depends on the number and cost-heterogeneity of competitors and not at all on the unit cost of a point. Linear common costs are held to spread the airdrop across a user base; Proposition 3 shows a small low-cost subset absorbs the pool and keeps the un-dissipated remainder as profit.

Proposition 3 is not new. It restates the standard asymmetric-Tullock active-set characterization in the notation of a points program, derived here for self-containedness: existence and uniqueness are Szidarovszky and Okuguchi (1997); the sort-and-admit rule and active-player count are Stein (2002), which is this setting after dividing each payoff by *cᵢ*; the share-function derivation is Cornes and Hartley (2005); the marginal-entry condition appears in Franke, Kanzow, Leininger and Schwartz (2013); and Konrad (2009) covers the family in textbook form. The contribution is the application, not the algebra.

---

## 2. Model

There are *n* potential entrants, indexed *i* = 1, …, *n*. A fixed prize *V* > 0 (the dollar value of the pool) is allocated by the proportional contest success function

$$p_i(e) = \frac{e_i}{S}, \qquad S \equiv \sum_{j=1}^n e_j,$$

with the convention *p*ᵢ = 1/*n* if *S* = 0, a case not payoff-relevant at any interior equilibrium. Effort *eᵢ* ≥ 0 is literally the number of points *i* accumulates. Each unit costs *i* a constant marginal *cᵢ* > 0 dollars, so

$$\pi_i(e) = V\,\frac{e_i}{S} - c_i e_i.$$

Assumptions:

1. **Risk neutrality.** Players maximize expected payoff, with no aversion to the variance the lottery CSF induces.
2. **Linear marginal cost.** *cᵢ* does not vary with *eᵢ*: no scale economies or diseconomies in point-farming.
3. **Complete information.** Costs and *n* are common knowledge: standard in the contest literature, strong, and not relaxed below.
4. **Simultaneous, one-shot moves.** No repeated play, signaling, or cross-season reputation.
5. **Continuous participation, not discrete entry.** There is no fixed entry cost; *eᵢ* = 0 is a corner of the same continuous choice available to all *n*. The concentration result is therefore not an artifact of assumed entry costs: it comes from heterogeneous linear costs meeting the concavity of the lottery CSF.

The first-order condition, holding others fixed, is

$$V\,\frac{S-e_i}{S^2} - c_i = 0 \quad\Longleftrightarrow\quad V\,\frac{S_{-i}}{S^2} = c_i, \qquad S_{-i}\equiv S-e_i,$$

and the second-order condition ∂²πᵢ/∂eᵢ² = −2*VS₋ᵢ*/*S*³ < 0 holds whenever *S₋ᵢ* > 0, so any interior stationary point is a local maximum given others' strategies.

---

## 3. Symmetric benchmark

**Proposition 1 (symmetric equilibrium).** If *cᵢ* = *c* for all *i*, the unique symmetric Nash equilibrium has

$$e^* = \frac{n-1}{n^2}\cdot\frac{V}{c}, \qquad S^* = \frac{n-1}{n}\cdot\frac{V}{c}, \qquad \text{spend}^* = cS^* = \frac{n-1}{n}V,$$

$$D(n) \equiv \frac{\text{spend}^*}{V} = \frac{n-1}{n} \;\xrightarrow[n\to\infty]{}\; 1.$$

*Proof.* Impose *eᵢ* = *e* in the FOC: *S* = *ne*, *S₋ᵢ* = (*n*−1)*e*, so *V*(*n*−1)*e*/(*n*²*e*²) = *c*, giving *e* = (*n*−1)*V*/(*n*²*c*). ∎

The active-set solver of Section 4, specialized to identical costs, reproduces this to zero absolute error for *n* ∈ {2, 5, 10, 50, 100, 500}. That is an internal consistency check rather than an independent one: under identical costs the solver reduces algebraically to the closed form. Dissipation rises from 0.500 at *n* = 2 to 0.998 at *n* = 500, monotonically approaching but never reaching 1.

**Proposition 2 (cost invariance).** *D*(*n*) = (*n*−1)/*n* contains no *c*. For fixed *n*, the dissipation fraction is exactly invariant to the unit cost of a point.

*Proof.* Immediate from Proposition 1. ∎

Holding *n* = 100 and sweeping *c* ∈ {0.1, 0.5, 1.0, 5.0, 25.0, 100.0}, a 1,000× range, dissipation is 0.990 at every point; the spread across the sweep is 2.220e−16. What moves is the points ledger: *S*\* = 990,000/*c*, so minting falls from 9.9 million points at *c* = $0.10 to 9,900 points at *c* = $100, while farmer spend stays pinned at $990k. A minimum trade size or a daily cap raises the effective marginal cost of a point, which changes the denominator of the points ledger, not the fraction of the pool competed away.

Source: Suwappu Research, `data/tullock_results.json`, keys `P1_symmetric_equilibrium` and `P2_cost_invariance`.

---

## 4. Heterogeneous costs and the active set

Order costs ascending, *c*₍₁₎ ≤ *c*₍₂₎ ≤ … ≤ *c*₍ₙ₎.

**Proposition 3 (active-set characterization).** There exists an integer *m* ∈ {2, …, *n*} and a subset *A* = {(1), …, (*m*)}, the *m* cheapest players, such that at equilibrium members of *A* are active and all others play *eᵢ* = 0, where

$$S = \frac{V(m-1)}{\sum_{i\in A} c_i}, \qquad e_i = S\left(1-\frac{c_i S}{V}\right) \text{ for } i\in A,$$

and *m* is the largest integer for which the marginal admitted player remains feasible, *c*₍ₘ₎ ≤ *V*/*S*.

*Proof.* For *i* ∈ *A*, the FOC *VS₋ᵢ*/*S*² = *cᵢ* rearranges to *eᵢ* = *S* − *cᵢS*²/*V*. Summing over *A* and using Σ*ᵢ*∈*A eᵢ* = *S*, since inactive players contribute zero:

$$S = mS - \frac{S^2}{V}\sum_{i\in A}c_i \;\Longrightarrow\; (m-1)S = \frac{S^2}{V}\sum_{i\in A}c_i \;\Longrightarrow\; S=\frac{V(m-1)}{\sum_{i\in A}c_i}.$$

Feasibility requires *eᵢ* ≥ 0 for every *i* ∈ *A*, i.e. *cᵢ* ≤ *V*/*S*, so only the most expensive member of *A* needs checking. *S*ₘ₊₁ > *S*ₘ holds exactly when *c*₍ₘ₊₁₎ < Σ*A c*/(*m*−1) = *V*/*S*ₘ, which is the feasibility condition itself, so each feasible admission raises *S*, lowers *V*/*S*, and tightens the bound on later admissions. That makes cheapest-first the correct search order. For *j* ∉ *A*, non-participation is optimal when ∂π*ⱼ*/∂*eⱼ*|₀ = *V*/*S* − *cⱼ* ≤ 0, which holds by construction for every player more expensive than *c*₍ₘ₎. ∎

This is the algorithm implemented in `exact_equilibrium()` (`code/tullock_sim.py`).

**Table 1 — the active set does not grow with the entrant pool.** Lognormal cost draw *cᵢ* = exp(εᵢ)/mean(exp(ε)), εᵢ ~ N(0, 0.6²); *V* = $1m; one realization per row.

| *n* potential | active | dissipation *D* | top-1 share of points |
|---:|---:|---:|---:|
| 10 | 5 | 0.665 | 0.478 |
| 50 | 7 | 0.735 | 0.398 |
| 200 | 5 | 0.786 | 0.293 |
| 1,000 | 8 | 0.815 | 0.282 |

Source: Suwappu Research, `data/tullock_results.json` key `P3_heterogeneous_costs`, seed 20260725. Single draw per row, no sampling band; the supported claim is qualitative, that active count stays in single digits across a hundredfold range of *n*, not the specific counts.

Adding participants from the same cost distribution does not proportionally add active farmers, because the added mass is priced out by the feasibility condition. Scaling to 5,000 potential entrants and drawing 500 independent cost vectors per dispersion level gives the sampling distribution of every quantity the paper depends on.

**Table 2 — who captures the pool. 5,000 potential entrants, *V* = $1m, 500 draws per σ, median [5th, 95th percentile].**

| σ | active / 5,000 | dissipation *D* | farmer surplus (share of pool) | top-1 share of pool |
|---:|---|---|---|---|
| 0.2 | 18 [12, 24] | 0.905 [0.857, 0.931] | 9.5% [6.9, 14.3] | 17.1% [11.3, 25.8] |
| 0.4 | 10 [7, 15] | 0.842 [0.733, 0.893] | 15.8% [10.7, 26.7] | 25.9% [16.2, 40.2] |
| 0.6 | 8 [5, 11] | 0.792 [0.664, 0.864] | 20.8% [13.6, 33.6] | 31.1% [20.2, 49.3] |
| 1.0 | 5 [3, 8] | 0.702 [0.491, 0.817] | 29.8% [18.3, 50.9] | 40.8% [25.5, 66.0] |

Source: Suwappu Research, `data/tullock_mc.json`, `code/tullock_mc.py`, seed 20260726. Lognormal costs normalized to unit mean. Farmer surplus is pool dollars won less dollars spent, summed over active players, as a share of *V*.

All four medians are monotone in σ. The active set contracts, dissipation falls, and both concentration measures rise, so the shortfall from the symmetric *D* → 1 ceiling is not protocol savings but a rent the surviving operators keep. At σ = 1.0 the median outcome is five active farmers out of 5,000, one of whom takes 40.8% of the pool, with 29.8% booked as profit across the five. What a naive "dissipation approaches 100%" reading expects to be wasted on gas and slippage is instead profit for professional farming infrastructure.

**Exhibit 1** (`figures/p2-exhibit-1-participation.png`) shows the active set contracting and operator profit expanding as dispersion widens. Bars are medians of the 500 draws per σ; whiskers span the 5th to 95th percentile. Source: Suwappu Research, `code/exhibits.py`, `data/tullock_mc.json`.

---

## 5. The denomination lever

Decompose the marginal cost of a point into *c* = *c*_protocol + *c*_external: the portion paid to the protocol as fee, and the portion leaving the system as gas, bridge cost, or slippage paid to third parties.

**Proposition 4 (revenue capture).** At the symmetric equilibrium,

$$R = \text{spend}^* \cdot \frac{c_{\text{protocol}}}{c} = D(n)\cdot V \cdot \frac{c_{\text{protocol}}}{c}.$$

*Proof.* spend\* = *cS*\* = *D*(*n*)*V* by Proposition 1; the protocol's share of every dollar spent is *c*_protocol/*c* by linearity of costs. ∎

**Table 3 — same burn, four destinations.** *n* = 100, *D* = 0.990, total spend $990k, pool $1m.

| design | *c*_protocol/*c* | total dissipated | protocol revenue | revenue / pool |
|---|---:|---:|---:|---:|
| volume-denominated (cost is external slippage and gas) | 0.050 | $990k | $49.5k | 5.0% |
| mixed (fee is half of marginal cost) | 0.500 | $990k | $495k | 49.5% |
| fee-denominated, cheap chain | 0.900 | $990k | $891k | 89.1% |
| fee-denominated, very cheap chain | 0.970 | $990k | $960k | 96.0% |

Source: Suwappu Research, `data/tullock_results.json` key `P5_revenue_capture`.

**Exhibit 2** (`figures/p2-exhibit-2-denomination.png`) shows the $990k burn holding constant across all four designs while the split between protocol revenue and third-party deadweight swings from $49.5k to $960k. Source: Suwappu Research, `code/exhibits.py`.

As *c*_protocol/*c* → 1, revenue *R* → *D*(*n*)*V*, which is not *V* unless *n* → ∞ as well. The self-funding airdrop needs both conditions at once, and gets neither free: gas and slippage never fully vanish on a real chain, so *c*_protocol/*c* < 1 strictly, and *n* is whatever the user base actually is.

**Corollary (sybil neutrality).** If points are strictly proportional to fees paid (pointsᵢ = α · feesᵢ, with no per-wallet floor or bonus), a farmer splitting a fixed budget across *k* wallets obtains

$$\text{own points} = k\cdot\frac{\text{budget}/k}{c} = \frac{\text{budget}}{c},$$

independent of *k*, so pool share is invariant to *k*. Measured deviation is exactly zero across *k* ∈ {1, 2, 5, 10, 100, 1000}: against 1,000,000 points of competing effort, a $100k budget at *c* = 1 holds pool share 0.091 at every *k*, and deviation stays at zero at every competing-effort level from 100,000 to 20,000,000 points.

The common anti-sybil design breaks this. A 25% bonus on the first 5,000 points *per wallet* lets a farmer re-trigger the capped bonus once per wallet. At $100k split across 1,000 wallets, $100 each is 100 points at *c* = 1, well under the threshold, so every wallet earns the full bonus; a single $100k wallet earns it only on the first 5,000 of 100,000 points. Against 1,000,000 points of competing effort, pool share rises from 0.092 at *k* = 1 to 0.111 at *k* = 1,000, a 1.209× gain, and across competing-effort levels from 100,000 to 20,000,000 points the gain runs 1.104× to 1.233× (Section 6). The mechanism built to fight sybils is the mechanism creating the sybil incentive. Remove the per-wallet threshold and splitting stops paying, so detection stops being load-bearing on this margin.

### 5.1 Applied design: Suwappu seasons

Suwappu's seasons program denominates points in fees paid rather than raw volume: points = 100 × fee_usd × multiplier (`docs/economics/SEASONS_TOKENOMICS.md`). By the corollary the pro-rata core is sybil-neutral; by Proposition 4 dissipated spend routes toward protocol revenue rather than external deadweight.

The engagement grants layered on that core are not fee-backed and are capped per wallet: 5,000 points per user per day, and 10,000 referral points per season (same source). That is the re-triggerable per-wallet structure the corollary identifies, and it carries the same incentive in kind. The exposure is bounded, not removed: at 100 points per fee dollar the daily cap is worth $50 of fee-backed activity per wallet per day, the number to compare against the cost of running an additional wallet.

Proposition 3 applies to our program as much as to any other: fee denomination changes where dissipated value lands, not who captures the pool, so our seasons program should be expected to concentrate on the terms of Table 2. Conversion to tokens is gated to a generation event that has not occurred, and we have no realized data on its active-participant count, concentration, or captured revenue.

---

## 6. Robustness

**What the verification suite establishes.** Four checks run against three symmetric cases (*n* ∈ {2, 10, 100}) and six heterogeneous lognormal cases (*n* ∈ {10, 200, 1000} × σ ∈ {0.3, 0.6}), implemented in `code/verify_equilibrium.py`. (A) First-order-condition residuals |*V*(*S*−*eᵢ*)/*S*² − *cᵢ*| for every active player peak at 1.221e−15. (B) No inactive player has a profitable entry, *V*/*S* − *cᵢ* ≤ 0 at every zero-effort player, in all nine cases. (C) A 4,000-point grid search over unilateral deviations, for up to five active and five inactive players per case, finds no improving deviation worth more than 2.910e−17 of the prize. (D) A separately coded damped best-response process (200,000 iterations, damping 0.02, initialized away from the claimed equilibrium) reproduces the aggregate to within 2.118e−15 relative error and recovers the same active-set size.

Checks A, B and D all evaluate or solve the model's own first-order condition; only C is calculus-free. The suite establishes that the solver correctly solves the stated game. It does not establish that the game describes reality.

**Sensitivity of the sybil gain.** The per-wallet-bonus gain depends on how much competing effort the farmer faces, which the first version of this analysis held fixed at one value.

| competing effort (points) | gain from *k* = 1,000 vs *k* = 1 | fee-denominated deviation |
|---:|---:|---:|
| 100,000 | 1.104× | 0.0 |
| 500,000 | 1.188× | 0.0 |
| 1,000,000 | 1.209× | 0.0 |
| 5,000,000 | 1.229× | 0.0 |
| 20,000,000 | 1.233× | 0.0 |

Source: Suwappu Research, `data/tullock_mc.json` key `sybil_sensitivity`. $100k budget, 25% bonus on the first 5,000 points per wallet, *c* = 1. Deviation is the change in pool share from splitting under strictly fee-proportional points.

The gain is a range, not a point, and it rises as the farmer's own share of the pool falls, approaching the bonus rate itself. It is a best response against fixed competing effort, not an equilibrium quantity. Fee-proportional points are exactly invariant at every level tested.

**Sampling distributions versus point estimates.** The first version of this paper reported one realization per dispersion level. Three of the four series in that table were non-monotone in σ, only the active count fell cleanly, and its concentration figures understated the result: at σ = 1.0 the single draw put top-1 share at 22.9% and farmer surplus at 19.9%, against Monte Carlo medians of 40.8% and 29.8%. Table 2 removes the internal contradiction and strengthens the finding in the same move. Table 1 remains single-draw and carries only its qualitative point.

---

## 7. Design implications

1. **Denominate points in fees paid to the protocol, not raw volume.** This is the only lever that changes where dissipated value lands (Proposition 4), and it is sybil-neutral with no detection system required for the pro-rata core.
2. **Do not add per-wallet floors, minimums, or bonuses to a pro-rata formula.** They create a 1.104× to 1.233× sybil incentive where none otherwise exists. If retention needs a bonus, build it with no re-triggerable per-wallet threshold.
3. **Do not expect caps or minimum trade sizes to reduce the dissipated fraction.** They change points minted, not *D*(*n*): hygiene against dust wash-trades, not a rent-seeking remedy.
4. **Expect thin participation dominated by a handful of professional operators.** Cost dispersion alone, with zero fixed entry cost and no cheating, produces a median 5 to 18 active out of 5,000, and 3 to 24 across the 5th-to-95th-percentile range. A founder who wants broad retail distribution should not use a continuous pro-rata contest as the primary mechanism.
5. **If broad distribution is the goal, this is structurally the wrong tool.** Mechanisms that break the aggregative externality do not inherit Proposition 3's concentration, because they remove the feature producing it: payoff depending on *share* of aggregate effort. Candidates are fixed per-action rewards, identity-gated allocations with superlinear marginal cost in wallet count, and lottery selection among qualifying actions. We have not modeled these; this is a direction, not a result.
6. **State the limit plainly to stakeholders.** Fee denomination moves captured value from external parties to the treasury without reducing concentration of that capture: a fee-denominated program still yields a small active set and a dominant top participant. Denomination improves the protocol's P&L; it does not solve farming and should not be described as doing so.

---

## 8. What would change our view

- **The obvious test, which we have not run.** For completed points-to-airdrop programs with public allocation snapshots, compute the top-10 share of allocated supply. The model predicts it lands near the Table 2 band, roughly 25% to 66% for the top recipient alone at wide dispersion. A measured top-10 share in the low single digits across several programs falsifies the mechanism as the dominant force, not merely the parameterization.
- **Broad, roughly even participation in a real program with verified cost heterogeneity.** Hundreds of participants each holding under 1% of a pool, with documented dispersion in cost per point, would put the complete-information Nash assumption in question.
- **A cap that changes the concentrated *fraction*, not just the quantity of points.** Proposition 2 predicts that imposing or removing a per-user cap leaves *D* unchanged while moving points minted by the same factor. We model caps as an increase in effective marginal cost; a hard quantity ceiling is instead a corner constraint on individual effort, unsolved here for heterogeneous costs, and a binding one plausibly does interact with the active-set logic by preventing the top farmer from scaling.
- **Removing a per-wallet bonus not reducing measured sybil activity.** The corollary predicts the 1.104× to 1.233× gain disappears. If it does not, that program's sybil incentives come from a source other than the bonus structure.
- **Convex cost curves.** Real farming plausibly carries fixed infrastructure costs and convexity at scale from liquidity constraints and detection risk. Convexity erodes the cheapest player's advantage as it scales, and is the leading candidate for real-world concentration being milder than a median 5 to 18 of 5,000.
- **Risk aversion and private information.** We assume neither. Risk-averse participants under-invest, which shows up as observed dissipation below the predicted 0.702 to 0.905 median band; cost uncertainty softens Proposition 3's sharp active/inactive cutoff into a smoother participation margin, the most likely source of any discrepancy in measured active-set size.
- **Price feedback.** *V* is a fixed dollar prize here. If heavy farming and subsequent selling depress the token price, *V* depends on the outcome of the contest being modeled, and realized dollar capture is lower than modeled for every participant, including the top operator.
- **Cost-distribution calibration.** The lognormal σ ∈ {0.2, …, 1.0} spans mild to large heterogeneity and is fit to no observed distribution of farmer costs, because that data is not public. Table 2 is evidence that concentration under heterogeneity is real and large across a plausible parameter range, not a forecast for any named program.

---

## Reproducibility

Every number here comes from three deterministic scripts; none is drawn from or calibrated against an observed points program.

- `code/tullock_sim.py` — closed-form and active-set solver; writes `data/tullock_results.json`. Seed `np.random.default_rng(20260725)`.
- `code/tullock_mc.py` — 500-draw Monte Carlo per σ at *n* = 5,000, and the sybil-gain sensitivity sweep; writes `data/tullock_mc.json`. Seed `np.random.default_rng(20260726)`.
- `code/verify_equilibrium.py` — checks A–D; imports `exact_equilibrium` from `tullock_sim.py`. Seed `np.random.default_rng(7)`.
- Console transcripts `data/sim_output.txt` and `data/verify_output.txt`; structured results `data/tullock_results.json` and `data/tullock_mc.json`, holding full precision for every rounded figure above.
- Exhibits `figures/p2-exhibit-1-participation.png` and `figures/p2-exhibit-2-denomination.png`, generated by `code/exhibits.py`. Applied-design reference: `docs/economics/SEASONS_TOKENOMICS.md`.

Run `code/tullock_sim.py`, then `code/tullock_mc.py`, then `code/verify_equilibrium.py`, under `numpy` and `matplotlib`. No other dependencies, no external data.

---

## Disclosures

This is research, not investment advice, and nothing here is a recommendation to buy, sell, or hold any token or security. Suwappu Research is the research function of Suwappu, which builds cross-chain trading and liquidity infrastructure and operates a fee-denominated seasons points program of the type analyzed in Section 5.1. We therefore have a direct commercial interest in the design conclusions of Section 7, and Section 5.1 should be read as an interested party's account of its own product. The author holds no position in any third-party token program referenced or alluded to here. We did not contact any issuer or program operator, and no figure reflects issuer confirmation. All inputs are self-generated by the simulation code listed under Reproducibility; there is no proprietary or third-party data in this paper. Views are the author's, not necessarily those of any other person at Suwappu.

---

## References

- Cornes, R., and Hartley, R. (2005). "Asymmetric contests with general technologies." *Economic Theory* 26, 923–946.
- Franke, J., Kanzow, C., Leininger, W., and Schwartz, A. (2013). "Effort maximization in asymmetric contest games with heterogeneous contestants." *Economic Theory*.
- Konrad, K. A. (2009). *Strategy and Dynamics in Contests*. Oxford University Press.
- Stein, W. E. (2002). "Asymmetric rent-seeking with more than two contestants." *Public Choice* 113, 325–336.
- Szidarovszky, F., and Okuguchi, K. (1997). "On the existence and uniqueness of pure Nash equilibrium in rent-seeking games." *Games and Economic Behavior* 18, 135–140.
- Tullock, G. (1980). "Efficient Rent Seeking." In Buchanan, J. M., Tollison, R. D., and Tullock, G. (eds.), *Toward a Theory of the Rent-Seeking Society*. Texas A&M University Press.