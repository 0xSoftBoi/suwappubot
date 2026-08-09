# Points-Program Economics After Empirical Rejection

**Conditional Tullock benchmarks for participation, dissipation, fee denomination, and wallet splitting**

Tsolmondorj Natsagdorj (0xSoftBoi), Suwappu Research
26 July 2026; materially revised 6 August 2026

*A closed-form equilibrium model of a pro-rata points contest, retained as a conditional mechanism benchmark after its active-set prediction failed a wallet-level field test. The revision separates solved model identities from rejected descriptive claims and corrects the original treatment of hard quantity caps.*

---

## Executive summary

- **Empirical status: the active-set prediction is rejected at wallet level.** In this model, 5,000 potential entrants with lognormal marginal-cost dispersion σ ∈ {0.2, 0.4, 0.6, 1.0} produce median active sets of 18, 10, 8 and 5 and median top-1 shares of 17.1%–40.8%. The companion field test measures 90,912 HYPE wallets and 239,035 EIGEN wallets, with top-1 shares of 0.73% and 2.40%. Its grid test finds no sampled σ that jointly matches observed participation and top-share concentration. **Tables 1–2 below are therefore model benchmarks, not forecasts for named programs.**

- **What the model does establish is conditional.** Under the stated one-shot, complete-information, risk-neutral game with unbounded effort and linear marginal cost, the equilibrium and active-set solver are internally verified. The model can answer "what follows if these assumptions hold?" It cannot establish that the assumptions describe a live incentive program.

- **Cost invariance is narrower than the first version claimed.** In the symmetric unconstrained benchmark, *D*(*n*) = (*n*−1)/*n* is invariant to a scalar common unit cost *c*. A **binding hard quantity cap is not a scalar cost change**; it is a corner constraint on effort and is not solved by Proposition 2. The original generalization from cost scaling to hard caps is retracted.

- **Fee denomination is a modeled destination-of-spend result, not a realized P&L forecast.** Holding modeled contest spend fixed, increasing the protocol share of marginal cost increases modeled protocol revenue. Table 3 is scenario arithmetic conditional on the cost decomposition; it does not show that a live program will dissipate $990k or that denomination is the only design lever available.

- **Wallet-splitting neutrality is also conditional.** If points are strictly proportional to fees and a participant's aggregate budget is fixed, splitting that budget across *k* wallets leaves own points unchanged. A per-wallet bonus breaks that invariance in the simulated example. This is a statement about the pro-rata formula, not proof of identity-level sybil resistance or a measurement of sybil prevalence.

- **Decision use.** Do not underwrite a points program as "roughly ten counterparties" from this model. Measure the actual recipient vector, govern entity resolution separately, model hard caps as constraints, and use the surviving identities only inside their stated assumptions.

---

## Why retain a model that failed its first field test?

Because a failed descriptive prediction can still leave useful conditional mechanics—provided the boundary is explicit. A pro-rata fixed-prize rule with costly effort maps cleanly into the Tullock proportional-contest family. The model below solves that game and shows how its equilibrium responds to cost dispersion, how modeled spend decomposes between protocol and external cost, and when a per-wallet nonlinear term creates a splitting incentive.

The companion evidence changes what can be inferred from those mechanics. It shows that the model's tiny active set is not a credible wallet-level description of the measured HYPE and EIGEN programs. It does **not** invalidate the algebraic identities inside the game. This revision keeps those identities, marks the rejected external-validity claim, and removes two overextensions from the original paper: the general hard-cap claim and the instruction to treat program allocation as a handful of professional counterparties.

For institutional diligence, that separation matters more than the model's drama. A solved equilibrium is **model evidence**. A recipient ledger is **measurement evidence**. Beneficial-owner concentration, realized revenue, market impact, legal treatment, and prudential risk require additional evidence and should not be inferred from either one by analogy.

---

## 1. The contest structure and its literature

A large share of token-distribution mechanisms shipped since 2022 convert accumulated activity into a pro-rata share of a fixed pool at a future token-generation event. If Pool dollars are split in proportion to points earned, and points cost something real to acquire (gas, capital lockup, slippage, or protocol fees), the payoff facing each user is the Tullock (1980) lottery contest payoff, and the equilibrium behavior of the program is the equilibrium behavior of a rent-seeking contest.

Two results organize the benchmark. Proposition 2 shows that **in the symmetric unconstrained game**, multiplying the common marginal unit cost changes equilibrium effort but not the dissipated fraction. It does not solve a binding hard-cap constraint. Proposition 3 characterizes the small active set that emerges **inside the heterogeneous linear-cost game**; the companion field test rejects that active-set prediction as a wallet-level description of the programs measured there.

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

Holding *n* = 100 and sweeping *c* ∈ {0.1, 0.5, 1.0, 5.0, 25.0, 100.0}, a 1,000× range, dissipation is 0.990 at every point; the spread across the sweep is 2.220e−16. What moves is the points ledger: *S*\* = 990,000/*c*, so minting falls from 9.9 million points at *c* = $0.10 to 9,900 points at *c* = $100, while modeled spend stays pinned at $990k.

**Scope correction (6 August 2026).** Proposition 2 establishes invariance to a **scalar common marginal cost** in an unconstrained symmetric game. A minimum trade size is a discrete-action constraint and a per-user daily quantity cap is an upper bound on effort; neither is generally equivalent to multiplying *c*. A binding hard cap can change individual best responses and therefore equilibrium dissipation. That constrained game is not solved here. The first version of this paper treated hard caps as if Proposition 2 covered them; that generalization was incorrect and is retracted.

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

**Table 1 — model benchmark: active-set size across entrant pools.** Lognormal cost draw *cᵢ* = exp(εᵢ)/mean(exp(ε)), εᵢ ~ N(0, 0.6²); *V* = $1m; one realization per row.

| *n* potential | active | dissipation *D* | top-1 share of points |
|---:|---:|---:|---:|
| 10 | 5 | 0.665 | 0.478 |
| 50 | 7 | 0.735 | 0.398 |
| 200 | 5 | 0.786 | 0.293 |
| 1,000 | 8 | 0.815 | 0.282 |

Source: Suwappu Research, `data/tullock_results.json` key `P3_heterogeneous_costs`, seed 20260725. Single draw per row, no sampling band; the supported claim is qualitative, that active count stays in single digits across a hundredfold range of *n*, not the specific counts.

Adding participants from the same cost distribution does not proportionally add active operators inside this model, because the added mass is priced out by the feasibility condition. Scaling to 5,000 potential entrants and drawing 500 independent cost vectors per dispersion level gives the sampling distribution of every quantity the paper depends on.

**Table 2 — model benchmark under heterogeneous costs. 5,000 potential entrants, *V* = $1m, 500 draws per σ, median [5th, 95th percentile].**

| σ | active / 5,000 | dissipation *D* | participant surplus (share of pool) | top-1 share of pool |
|---:|---|---|---|---|
| 0.2 | 18 [12, 24] | 0.905 [0.857, 0.931] | 9.5% [6.9, 14.3] | 17.1% [11.3, 25.8] |
| 0.4 | 10 [7, 15] | 0.842 [0.733, 0.893] | 15.8% [10.7, 26.7] | 25.9% [16.2, 40.2] |
| 0.6 | 8 [5, 11] | 0.792 [0.664, 0.864] | 20.8% [13.6, 33.6] | 31.1% [20.2, 49.3] |
| 1.0 | 5 [3, 8] | 0.702 [0.491, 0.817] | 29.8% [18.3, 50.9] | 40.8% [25.5, 66.0] |

Source: Suwappu Research, `data/tullock_mc.json`, `code/tullock_mc.py`, seed 20260726. Lognormal costs normalized to unit mean. Farmer surplus is pool dollars won less dollars spent, summed over active players, as a share of *V*.

All four medians are monotone in σ. The active set contracts, dissipation falls, and both concentration measures rise, so the shortfall from the symmetric *D* → 1 ceiling appears as participant surplus inside the model, not as protocol savings. At σ = 1.0 the median outcome is five active operators out of 5,000, one of whom takes 40.8% of the pool, with 29.8% retained as surplus across the five. These are model allocations, not evidence about professional operators in a named program.

**Exhibit 1** (`figures/p2-exhibit-1-participation.png`) shows the active set contracting and operator profit expanding as dispersion widens. Bars are medians of the 500 draws per σ; whiskers span the 5th to 95th percentile. Source: Suwappu Research, `code/exhibits.py`, `data/tullock_mc.json`.

---

## 5. The denomination lever

Decompose the marginal cost of a point into *c* = *c*_protocol + *c*_external: the portion paid to the protocol as fee, and the portion leaving the system as gas, bridge cost, or slippage paid to third parties.

**Proposition 4 (revenue capture).** At the symmetric equilibrium,

$$R = \text{spend}^* \cdot \frac{c_{\text{protocol}}}{c} = D(n)\cdot V \cdot \frac{c_{\text{protocol}}}{c}.$$

*Proof.* spend\* = *cS*\* = *D*(*n*)*V* by Proposition 1; the protocol's share of every dollar spent is *c*_protocol/*c* by linearity of costs. ∎

**Table 3 — conditional benchmark: fixed modeled spend, four destinations.** *n* = 100, *D* = 0.990, modeled total spend $990k, pool $1m.

| design | *c*_protocol/*c* | total dissipated | protocol revenue | revenue / pool |
|---|---:|---:|---:|---:|
| volume-denominated (cost is external slippage and gas) | 0.050 | $990k | $49.5k | 5.0% |
| mixed (fee is half of marginal cost) | 0.500 | $990k | $495k | 49.5% |
| fee-denominated, low external-cost case | 0.900 | $990k | $891k | 89.1% |
| fee-denominated, very-low external-cost case | 0.970 | $990k | $960k | 96.0% |

Source: Suwappu Research, `data/tullock_results.json` key `P5_revenue_capture`.

**Exhibit 2** (`figures/p2-exhibit-2-denomination.png`) holds modeled spend at $990k and varies the assumed protocol share of marginal cost, moving modeled protocol revenue from $49.5k to $960k. It is comparative-static scenario arithmetic, not observed revenue. Source: Suwappu Research, `code/exhibits.py`.

As *c*_protocol/*c* → 1, revenue *R* → *D*(*n*)*V*, which is not *V* unless *n* → ∞ as well. In a live program, external execution costs remain nonzero and participation is endogenous. The identity therefore does not establish full economic cost recovery.

**Corollary (fixed-budget wallet-splitting invariance).** If points are strictly proportional to fees paid (pointsᵢ = α · feesᵢ, with no per-wallet floor or bonus), a participant splitting a fixed aggregate budget across *k* wallets obtains

$$\text{own points} = k\cdot\frac{\text{budget}/k}{c} = \frac{\text{budget}}{c},$$

independent of *k*, so pool share is invariant to *k* **holding aggregate budget and competing effort fixed**. Measured deviation is exactly zero across *k* ∈ {1, 2, 5, 10, 100, 1000}: against 1,000,000 points of competing effort, a $100k budget at *c* = 1 holds pool share 0.091 at every *k*, and deviation stays at zero at every competing-effort level from 100,000 to 20,000,000 points. This is not a general proof of identity-level sybil resistance; it isolates one wallet-splitting margin in the pro-rata formula.

A per-wallet bonus breaks this invariance. A 25% bonus on the first 5,000 points *per wallet* lets a participant re-trigger the bonus once per wallet. At $100k split across 1,000 wallets, $100 each is 100 points at *c* = 1, below the threshold, so every wallet earns the full bonus; a single $100k wallet earns it only on the first 5,000 of 100,000 points. Against 1,000,000 points of competing effort, modeled pool share rises from 0.092 at *k* = 1 to 0.111 at *k* = 1,000, a 1.209× gain, and across competing-effort levels from 100,000 to 20,000,000 points the gain runs 1.104× to 1.233× (Section 6). The supported conclusion is specific: **this nonlinear per-wallet term creates a splitting incentive absent from the fixed-budget proportional core.** The analysis does not estimate how much sybil behavior a live program will exhibit.

### 5.1 Applied design: Suwappu source configuration

The repository snapshot reviewed on 6 August 2026 configures the pro-rata fee component at 100 points per fee dollar, with separate per-user engagement and referral limits. That source state is evidence about the implemented formula; it is not, by itself, evidence that a particular production deployment is enabled or that a future token allocation will use the same parameters unchanged.

The fixed-budget wallet-splitting corollary applies only to the strictly fee-proportional component. Per-user grants and referral terms are nonlinear wallet-level features and sit outside that invariance result; they require their own abuse analysis. Likewise, Proposition 4 says what happens to modeled contest spend **if** the assumed marginal-cost decomposition holds. It does not establish realized program revenue.

The original paper also projected Table 2's active-set concentration onto Suwappu's own program. That projection is withdrawn. No completed Suwappu token distribution is measured here, so the concentration of any eventual allocation is **unverified**. The companion paper's roughly 60% top-percentile wallet shares are empirical observations for HYPE, EIGEN, and ENA—not a calibrated forecast for Suwappu.

---

## 6. Robustness

**What the verification suite establishes.** Four checks run against three symmetric cases (*n* ∈ {2, 10, 100}) and six heterogeneous lognormal cases (*n* ∈ {10, 200, 1000} × σ ∈ {0.3, 0.6}), implemented in `code/verify_equilibrium.py`. (A) First-order-condition residuals |*V*(*S*−*eᵢ*)/*S*² − *cᵢ*| for every active player peak at 1.221e−15. (B) No inactive player has a profitable entry, *V*/*S* − *cᵢ* ≤ 0 at every zero-effort player, in all nine cases. (C) A 4,000-point grid search over unilateral deviations, for up to five active and five inactive players per case, finds no improving deviation worth more than 2.910e−17 of the prize. (D) A separately coded damped best-response process (200,000 iterations, damping 0.02, initialized away from the claimed equilibrium) reproduces the aggregate to within 2.118e−15 relative error and recovers the same active-set size.

Checks A, B and D all evaluate or solve the model's own first-order condition; only C is calculus-free. The suite establishes that the solver correctly solves the stated game. It does not establish that the game describes reality.

**Sensitivity of the wallet-splitting gain.** The per-wallet-bonus gain depends on how much competing effort the participant faces, which the first version of this analysis held fixed at one value.

| competing effort (points) | gain from *k* = 1,000 vs *k* = 1 | fee-denominated deviation |
|---:|---:|---:|
| 100,000 | 1.104× | 0.0 |
| 500,000 | 1.188× | 0.0 |
| 1,000,000 | 1.209× | 0.0 |
| 5,000,000 | 1.229× | 0.0 |
| 20,000,000 | 1.233× | 0.0 |

Source: Suwappu Research, `data/tullock_mc.json` key `sybil_sensitivity`. $100k budget, 25% bonus on the first 5,000 points per wallet, *c* = 1. Deviation is the change in pool share from splitting under strictly fee-proportional points.

The gain is a range, not a point, and it rises as the participant's own share of the pool falls, approaching the bonus rate itself. It is a best response against fixed competing effort, not an equilibrium quantity. Fee-proportional points are exactly invariant at every level tested.

**Sampling distributions versus point estimates.** The first version of this paper reported one realization per dispersion level. Three of the four series in that table were non-monotone in σ, only the active count fell cleanly, and its concentration figures understated the result: at σ = 1.0 the single draw put top-1 share at 22.9% and participant surplus at 19.9%, against Monte Carlo medians of 40.8% and 29.8%. Table 2 removes the internal contradiction and strengthens the model result in the same move. Table 1 remains single-draw and carries only its qualitative point.

---

## 7. Design implications

1. **Treat fee denomination as a cost-allocation choice, not a concentration guarantee.** Proposition 4 says that, within the symmetric benchmark, a larger protocol share of marginal cost sends more modeled contest spend to the protocol. It does not establish realized revenue or a distributional outcome.
2. **Test every per-wallet nonlinearity for splitting incentives.** The simulated 25% first-5,000-points bonus makes splitting a fixed budget across wallets more valuable by 1.104×–1.233× across the tested competing-effort range. That result is specific to the stated bonus and fixed-budget comparison; it is not a forecast of live sybil prevalence.
3. **Model hard caps as hard constraints.** Proposition 2 does not justify the original claim that a binding daily cap leaves dissipation unchanged. Any policy decision that depends on cap effectiveness needs a constrained model or empirical test.
4. **Do not use Table 2 as an ownership or counterparty forecast.** The companion data reject its small active set at wallet level. Entity concentration must be measured with recipient data and, where possible, beneficial-owner resolution.
5. **Separate mechanism hygiene from distribution objectives.** A formula can remove one wallet-splitting incentive without proving broad ownership, retention, lower sell pressure, or reduced economic waste. Those are separate outcomes with separate evidence requirements.
6. **Govern model status explicitly.** For descriptive allocation use, the active-set model is **challenged by empirical evidence**. For conditional mechanism arithmetic, the model remains **usable within assumptions**. New external claims should state which status they rely on.

---

## 8. What would change our view

- **Beneficial-owner resolution.** Credible clustering that collapses the HYPE/EIGEN wallet populations toward the modeled active set would weaken or reverse the companion paper's wallet-level rejection. The companion study quantifies how extreme that clustering would need to be.
- **A constrained hard-cap solution.** Solving or simulating the game with explicit per-player effort ceilings would determine where Proposition 2 stops being informative for program caps.
- **Measured budgets and marginal costs.** Direct evidence on participant capital constraints, activity that would have occurred without rewards, and heterogeneous cost per point would let us replace the current lognormal scenarios with a calibrated behavioral model.
- **Out-of-sample completed programs.** More clean recipient vectors can establish whether HYPE/EIGEN are representative or exceptional. A program with a genuine top-wallet concentration near Table 2 would reopen the active-set channel for that design class.
- **Entity-level incentive experiments.** Removing or varying a per-wallet bonus while holding the core formula constant would test whether the algebraic splitting incentive has a material behavioral effect.
- **Realized Suwappu outcome data.** If a future Suwappu allocation occurs, it should be evaluated as a new empirical observation rather than treated as validation by design intent.

---

## Reproducibility

Every **model number in Tables 1–3 and Section 6** comes from three deterministic scripts and is not calibrated against an observed points program. The empirical HYPE/EIGEN figures cited in the executive summary come from the separately released companion study and are not inputs to these simulations.

- `code/tullock_sim.py` — closed-form and active-set solver; writes `data/tullock_results.json`. Seed `np.random.default_rng(20260725)`.
- `code/tullock_mc.py` — 500-draw Monte Carlo per σ at *n* = 5,000, and the wallet-splitting sensitivity sweep; writes `data/tullock_mc.json`. Seed `np.random.default_rng(20260726)`.
- `code/verify_equilibrium.py` — checks A–D; imports `exact_equilibrium` from `tullock_sim.py`. Seed `np.random.default_rng(7)`.
- Console transcripts `data/sim_output.txt` and `data/verify_output.txt`; structured results `data/tullock_results.json` and `data/tullock_mc.json`, holding full precision for every rounded figure above.
- Exhibits `figures/p2-exhibit-1-participation.png` and `figures/p2-exhibit-2-denomination.png`, generated by `code/exhibits.py`. Applied-design reference: `docs/economics/SEASONS_TOKENOMICS.md`.

Run `code/tullock_sim.py`, then `code/tullock_mc.py`, then `code/verify_equilibrium.py`, under `numpy` and `matplotlib`. No other dependencies, no external data.

---

## Disclosures

This is research, not investment, legal, accounting, or prudential advice, and nothing here is a recommendation to buy, sell, or hold any token or security. Suwappu builds financial-execution infrastructure and has a commercial interest in fee-denominated incentive design; Section 5.1 is therefore an interested party's account of its own source configuration. This paper does not verify production enablement or a completed Suwappu token distribution. The author holds no position in any third-party token program taken on the basis of this analysis. No issuer or program operator reviewed the model. Model inputs are self-generated by the simulation code listed under Reproducibility; the companion empirical data is separately documented and released. The paper's active-set prediction failed its first published wallet-level field test, and that challenged status is part of the current conclusion.

---

## References

- Cornes, R., and Hartley, R. (2005). "Asymmetric contests with general technologies." *Economic Theory* 26, 923–946.
- Franke, J., Kanzow, C., Leininger, W., and Schwartz, A. (2013). "Effort maximization in asymmetric contest games with heterogeneous contestants." *Economic Theory*.
- Konrad, K. A. (2009). *Strategy and Dynamics in Contests*. Oxford University Press.
- Stein, W. E. (2002). "Asymmetric rent-seeking with more than two contestants." *Public Choice* 113, 325–336.
- Szidarovszky, F., and Okuguchi, K. (1997). "On the existence and uniqueness of pure Nash equilibrium in rent-seeking games." *Games and Economic Behavior* 18, 135–140.
- Tullock, G. (1980). "Efficient Rent Seeking." In Buchanan, J. M., Tollison, R. D., and Tullock, G. (eds.), *Toward a Theory of the Rent-Seeking Society*. Texas A&M University Press.
