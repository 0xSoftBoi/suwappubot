# Quadratic-Flow Router — Design Specification

**Optimal multi-pool routing via linear resistor networks with diodes**

Version 1.0 · Status: **design, superseded in places by what was built**

Kept as the reference for derivations and for the `§` numbers the code cites.
Read [`theory.md`](theory.md) first: it covers the same idea and then what
actually runs, and it is the one to trust where the two disagree.
[`browser-port.md`](browser-port.md) is the Flet / Pyodide port.

---

## 0. Summary

Route amount `X` of token `src` into the maximum obtainable amount of token `dst` across `m ≈ 10³` liquidity pools spanning `n ≈ 10²` tokens, splitting in parallel and chaining in series.

**Core claim.** If each pool is modelled by its first two derivatives with `f''` held constant, and flows are measured in *value* rather than token units, the routing problem becomes exactly

> a **linear resistor network with diodes**: conductance `G_p ∝ pool depth`, forward drop `ε_p = fee + price dislocation`,

whose solution is a **sparse SPD graph-Laplacian solve** inside a finite active-set loop. No path enumeration. Column generation yields a **certificate of global optimality** over all `m` pools while touching only a few dozen.

The model is *conservative* (under-promises) by construction. Its `O(θ²)` error is irrelevant to which pools get selected and how flow splits — both of which are first-order-flat at the optimum — so the model is used for **combinatorics**, and exact on-chain evaluation is used for **arithmetic**.

**Pipeline.**

```
reference prices (1 Laplacian solve)
   → probe ladder: calibrate (a_p, B_p) + detect non-concavity
   → seed subgraph (k-shortest paths)
   → active-set solve (Laplacian per pivot)
   → price out all m pools → certificate
   → N candidates: active-set diverse, + ratio sweep on flagged arcs
   → multicall verification on-chain (pinned block)
   → refit + re-solve → final quote & calldata
```

**Non-concave arcs.** Pools whose *effective fee falls with size* — CryptoSwap-NG dynamic fees on the rebalancing side, rebate tiers, RFQ ladders — are locally tunnel diodes: negative differential resistance, no uniqueness, no certificate. They are handled by **detect-clamp-sweep**, not by better local modelling: a more faithful Taylor fit is *inadmissible*, not merely inaccurate, because `f'' > 0` makes the Laplacian indefinite. §11.2 has the mechanism and a worked case where naive handling loses 0.5 bp.

**Non-goals.** Gas-optimal routing (non-convex; handled greedily, outside the core), certified optimality in the presence of non-concave arcs (bounded and swept, not proven), cross-block or time-varying reserves (the network here is purely resistive, memoryless).

---

## 1. Notation

| Symbol | Meaning | Units |
|---|---|---|
| `t ∈ T`, `\|T\| = n` | token (graph node) | — |
| `p ∈ P`, `\|P\| = m` | pool arc, directed `τ(p) → σ(p)` | — |
| `τ(p)`, `σ(p)` | input token, output token of arc `p` | — |
| `δ_p ≥ 0` | input amount to pool `p` | token `τ(p)` |
| `f_p(δ)` | output for input `δ`, **fee included** | token `σ(p)` |
| `a_p = f_p'(0⁺)` | marginal rate at zero size (post-fee) | `σ`/`τ` |
| `b_p = f_p''` | curvature, `b_p < 0`; write `B_p = \|b_p\|` | `σ`/`τ²` |
| `ν̂_t > 0` | reference price of token `t` | numéraire/token |
| `ψ_p ≥ 0` | **value** flow into arc `p` | numéraire |
| `Ψ = ν̂_src · X` | total value routed | numéraire |
| `ε_p` | fractional value loss at zero size | dimensionless |
| `G_p` | arc conductance | numéraire |
| `u_t` | node potential (dual variable) | dimensionless |
| `ρ_p` | reduced cost of arc `p` | dimensionless |
| `θ_p = δ_p / y_p` | trade size / input reserve | dimensionless |
| `A ⊆ P` | active set (arcs carrying flow) | — |
| `S ⊆ P` | working subgraph (column generation) | — |

Convention: `(z)₊ = max(z, 0)`. A bidirectional pool is **two independently calibrated arcs**; at most one is ever active (§2.6), and `a`, `B`, `cap`, `CONVEX_FLAG` and every diagnostic are per-arc, never per-pool. Subscripts `f` / `r` denote the two directions of the same pool when they are being compared.

---

## 2. Pool model

### 2.1 Exact pool

Each pool exposes a concave, increasing `f_p : [0, ∞) → [0, ∞)` with `f_p(0) = 0`:

```
f_p' > 0        (monotone output)
f_p'' < 0       (price impact)
```

Concavity is the **load-bearing assumption**. It makes the routing program convex, makes the element law monotone, and is what Minty's theorem needs for existence and uniqueness. Everything downstream fails without it (§11.2).

For constant product `x·y = k` with fee `φ`, input reserve `y₀`, output reserve `x₀`, and `δ̃ = (1−φ)δ`:

```
f(δ)   = x₀ δ̃ / (y₀ + δ̃)
f'(δ)  = (1−φ)   x₀ y₀ / (y₀ + δ̃)²      ⟹  a = (1−φ) x₀/y₀
f''(δ) = −2(1−φ)² x₀ y₀ / (y₀ + δ̃)³     ⟹  B = 2(1−φ)² x₀/y₀²
```

Token-space conductance:

```
−f'/f'' = (y₀ + δ̃) / (2(1−φ))    →   y₀ / (2(1−φ))   at δ = 0
```

### 2.2 Quadratic model

Freeze the curvature:

```
f̂_p(δ) = a_p δ − ½ B_p δ²                          (M1)
f̂_p'(δ) = a_p − B_p δ
```

Valid domain `δ ∈ [0, δ̄_p]` with `δ̄_p = a_p / B_p` — where `f̂'` hits zero. Beyond `δ̄_p` the model turns *decreasing*, so it must be imposed as a hard box constraint, not merely watched. For CPMM `δ̄ = y₀ / (2(1−φ))`, i.e. `θ ≈ 0.5`; you will always be far inside it, but the constraint is cheap insurance against solver excursions.

### 2.3 Calibration — the probe ladder

Four evaluations of the true `f_p` — the free origin (`f_p(0) = 0` exactly) plus three quoter calls — determine `(a_p, B_p)` **and** tell you whether the quadratic model is admissible at all. No per-family math, and the probes ride in the same multicall as everything else (§7), so the marginal cost of the third probe is one array entry.

Probe at `δ_ε` (tiny) and at `δ̄_p · {¼, ½, 1}`, where `δ̄_p` is the expected trade size:

```
a_p = f_p(δ_ε) / δ_ε                       δ_ε = 10⁻⁶ · reserve
B_p = 2 (a_p δ̄_p − f_p(δ̄_p)) / δ̄_p²       secant fit                   (M2)
```

The second line is a **secant fit**: `f̂_p` matches the true curve exactly at `0` and at `δ̄_p`. Use it, not the tangent fit `B_p = |f_p''(0)|` — see §2.4.

**Divided differences from the same ladder — free.** With nodes `0 < δ̄/4 < δ̄/2 < δ̄`:

```
D₁ = f[0, δ̄/4, δ̄/2]        = ½ f''(ξ₁),   ξ₁ ∈ (0, δ̄/2)
D₂ = f[δ̄/4, δ̄/2, δ̄]        = ½ f''(ξ₂),   ξ₂ ∈ (δ̄/4, δ̄)              (M2b)
D₃ = f[0, δ̄/4, δ̄/2, δ̄]     = ⅙ f'''(ξ₃),  ξ₃ ∈ (0, δ̄)
```

(Divided-difference mean-value form; the `ξ` are exact, not asymptotic.) These yield three numbers that drive everything downstream:

```
CONVEX_FLAG_p ⟸ D₁ > 0  or  D₂ > 0  or  sign(D₁) ≠ sign(D₂)
DRIFT_p       =  D₂/D₁ − 1              # 0 ⟹ f'' genuinely constant on the sampled range
η_p           =  3 a_p D₃ / (2 D₂²)     # family check, §12.2 — no extra calls
```

**The ladder is a detector, not a model.** `D₃` and `η_p` are diagnostics; they are never substituted into the solve. The element law stays quadratic — §11.3 explains why no Taylor order is admissible as a replacement, and §11.2 why a *faithful* local model of a non-concave pool is worse than useless in a convex program.

**Known limitation — probe spacing versus the notch.** A local ladder detects pointwise curvature at the sampled scale. It cannot see a *chord*: a defect narrow in `δ` can induce a hull chord spanning two orders of magnitude (§11.2). Probes wide enough to be useful for calibration step cleanly over a narrow notch and report a perfectly well-behaved concave curve. Hence `CONVEX_FLAG` is belt-and-braces: the numeric test above **plus** a structural test from pool metadata, `outFee ≠ midFee` and the trade direction moves the pool toward balance. Set the flag if either fires.

#### The zero-curvature clamp

When the fit returns `B_p ≤ 0` — the fee is falling with size fast enough to beat price impact — the admissible limit is `B_p = 0`: a **linear arc, no price impact, infinite depth**. In circuit terms an ideal diode with forward drop `ε_p` and *no series resistance*. That is the correct element, and it is exactly the local concave envelope. Three rules make it usable:

**(1) Clamp `a` too, not just `B`.** Clamping `B → 0` while keeping `a = f'(0)` leaves the *tangent*, which on a convex piece lies **below** the curve — an under-estimate that can cause the solver to skip the arc silently. Take the **chord** instead:

```
if B_p ≤ 0:
    cap_p ← width of the flagged region (below)
    a_p   ← f_p(cap_p) / cap_p          # chord slope — exact at 0 and cap_p
    B_p   ← 0                            # then numerically ceilinged, rule (3)
```

The chord is exact at both endpoints and above the curve in between: a valid concave majorant, hence an upper bound, hence it cannot prune the true optimum. It also lowers `ε_p` — the arc's average rate genuinely is better than its marginal rate at zero, which is the whole phenomenon.

**(2) `cap_p` is mandatory, not optional.** A `B = 0` arc has no mechanism bounding its own flow; the quadratic term was that mechanism. Put one in a cycle with negative total `ε` and the flow is unbounded. The cap is not a safety margin, it is the element's definition — and it is available for free, because the convex region always terminates:

| family | convex region | `cap_p` |
|---|---|---|
| CryptoSwap-NG, rebalancing | `X₀ → X_*` (apex of `k`) | input reaching `X_*`; past it `Γ_X < 0` and concavity returns |
| RFQ / rebate ladder | up to the next tier boundary | tier size |
| generic probe-flagged | up to the last ladder node with `D > 0` | that node; refine by bisection if it matters |

For CryptoSwap this makes the arc split of §2.5 and the clamp the *same operation*: split at the apex, clamp the rebalancing side, cap it there.

**(3) Ceiling `G`, never divide by a tiny `B`.** `G_p = ν̂ a_p/B_p` with `B_p = 10⁻³⁰` gives `G_p ~ 10³⁰` and destroys the condition number of the entire Laplacian — worse than the defect it was patching. Ceiling in conductance space instead:

```
G_p ← min( G_p, 10³ · max{ G_q : q unflagged } )
```

This keeps every structural property (SPD Laplacian, finite pivoting, certificate machinery) at a bounded, quantified cost, and the arc is still effectively bottomless relative to anything else in the graph.

**The clamp makes the arc more attractive, not less.** Zero impact plus a chord rate means the solver will preferentially fill it, up to `cap_p`. That is the correct direction for a relaxation — an upper bound never prunes the optimum — but it means **a flagged arc will usually survive into the route rather than being probed away**. The probe may remove it; you cannot rely on that. Everything downstream (`certificate = False`, the §6.3 pin sweep, the §7 multicall) is therefore load-bearing rather than defensive.

Bootstrapping `δ̄_p` (the expected size, unknown before solving):

```
δ̄_p⁽⁰⁾ = X · min(1, Ĝ_p / Σ_{q ∈ N(p)} Ĝ_q)     Ĝ from tangent curvature
solve → realized δ_p → recalibrate → re-solve
```

One recalibration round is enough in practice; §12 gives the check that tells you when it isn't.

Closed forms as fast paths (avoid the probe when state is already in hand):

| Family | `a` (pre-fee) | `B` (pre-fee) | Notes |
|---|---|---|---|
| Uniswap v2 / Sushi | `x₀/y₀` | `2x₀/y₀²` | multiply `a` by `(1−φ)`, `B` by `(1−φ)²` |
| Uniswap v3, in-tick | `1/p` | `2/(L·p^{3/2})` | virtual reserves `x_v = L/√p`, `y_v = L√p` |
| Balancer weighted | `(w_y x₀)/(w_x y₀)` | `a(w_x+w_y)/(w_x y₀)` | |
| Curve stableswap | probe | probe | **split arc at peg boundary**, §2.5 |
| CryptoSwap-NG, **fixed fee** | `Γ p(X₀)` | `−Γ p_X(X₀)` | exact; `p, p_X` closed-form, see below |
| CryptoSwap-NG, **dynamic fee** | `m(X₀)` | `−m_X(X₀)` | `m = Γp + Γ_X Δ`; **may be `< 0` ⟹ flag**, §11.2 |
| Curve tricrypto | probe | probe | select the `(x,y)` pair per arc |

**CryptoSwap-NG closed forms.** With normalized balances `X = x/D`, `q = Nᴺ∏Xᵢ`, spectator sum `Z` and product factor `c` (§L2 of the CryptoSwap-NG split math), the invariant reduces on any direct pair to `q = cXY`, `X + Y = R(q) − Z`. Writing `L = −cR'(q) > 0` and `L_q = −cR''(q) < 0`:

```
p    = (1 + LY)/(1 + LX)                    > 0
q_X  = c(Y − X)/(1 + LX)
p_X  = (L_q q_X²/c − 2Lp)/(1 + LX)          < 0   globally
```

Gross output is therefore **strictly concave for every fixed-`D` direct pair**, `N ∈ {2,3}`, both orientations. Under a constant retention `Γ` the arc inherits this: `B_X = Γp`, `B_XX = Γp_X < 0`, so fixed-fee CryptoSwap arcs are fully admissible with zero probing.

Under the *dynamic* endpoint fee, `Γ = 1 − φ_out + δ w(k)` varies along the path and the fee-adjusted marginal is

```
m   = Γ p + Γ_X Δ                           Δ = Y_balance,0 − Y(X)
m_X = Γ p_X + 2 Γ_X p + Γ_XX Δ
```

`m ≠ Γp`: the fee term re-prices the *accumulated* output. Since `p_X < 0` globally, the `Γ_X, Γ_XX` terms are the **only** source of non-concavity in the entire family — and they are what §11.2 is about.

### 2.4 Accuracy budget

For CPMM with `θ = δ̃/y₀`, the **tangent** fit (`B = |f''(0)|`) gives an exact ratio:

```
f̂ / f = 1 − θ²
```

The **secant** fit at `θ̄` gives

```
f̂ / f = (1 + θ)(1 + θ̄ − θ)/(1 + θ̄)
```

which is exact at `θ = 0` and `θ = θ̄`, with a maximum overshoot of `≈ θ̄²/4` at `θ = θ̄/2`.

| `θ` | tangent | secant (`θ̄ = θ`) |
|---|---|---|
| 1 % | −1 bp | +0.02 bp |
| 3 % | −9 bp | +0.2 bp |
| 5 % | −25 bp | +0.6 bp |
| 10 % | −100 bp | +2.5 bp |
| 20 % | −400 bp | +10 bp |

**Sign matters.** The tangent fit under-promises — the correct direction for a router, since on-chain reality then beats the quote. The secant fit is 4× tighter but overshoots mid-range, so its output must be re-verified against exact `f` before quoting. Recommended: **secant for solving, exact for quoting** (§7 does this anyway).

Do not go to third order. `f'''` is not independent for constant-product pools (`f''' ≡ 3(f'')²/(2f')` identically), it introduces a hard wall where the discriminant of the cubic stationarity vanishes (`θ ≈ 22 %` for CPMM), and past the inflection it makes `f''  > 0` — locally convex, i.e. increasing returns, which an optimizer will chase to infinity. The quadratic model has no such failure mode. Where a single pool genuinely needs more fidelity, use the power-law form of §11.3 or split the arc (§2.5).

### 2.5 Arc splitting — the answer to non-constant density

Constant `f''` fails where liquidity density has a jump or a short characteristic scale. Raising the polynomial order does not help there (it is Runge behaviour: higher derivatives are *more* contaminated by the nearby feature). **Split the arc instead** — it preserves linearity of the element law and finite pivoting:

- **Uniswap v3.** One arc per tick range, each with its own `(a_k, B_k)` from the in-tick closed form and a **capacity** `cap_k = L_k · (√p_b − √p_a)` on the input side. Within a tick, virtual reserves are large, local `θ` is tiny, and the quadratic is near-exact — this is essentially free accuracy. Capacities turn the program into a bounded-variable QP (§5.4), still finite.
- **Curve stableswap.** Two arcs in series: in-peg (deep, small `B`) and off-peg (shallow, large `B`), with the in-peg arc capacitated at the imbalance that exits the flat region. A single tangent fit at the peg will wildly over-promise on any trade that leaves it — this is the most dangerous single mis-calibration in the system.
- **CryptoSwap-NG with dynamic fee.** Split at the **apex** `X_*`, the input coordinate maximising the balance indicator `k(q) = q/R(q)ᴺ`. The non-concavity is localised there (the fee weight `w_o = ε/(ε + 1 − k)` is a near-step in `k` for the deployed `ε ∼ 10⁻⁸`), so the *imbalancing* side is concave and fully admissible, while the *rebalancing* side carries the defect. Emit the imbalancing arc normally; emit the rebalancing arc with `CONVEX_FLAG` set. This localisation is exactly what the pole-adapted chart of the source lemmas formalises, and it makes the flag cheap: it is a sign test on `X − X_*`, not a curve analysis.
- **Multi-asset pools.** Do not decompose into `(x,y)` pairs and discard cross-terms in general; instead emit one arc per ordered token pair actually usable, each calibrated by probe (M2) against the true multi-asset quoter. The node set simply gains more incident arcs.

---

### 2.6 Direction asymmetry — measure each direction separately

A bidirectional pool is **two arcs, calibrated independently**. Deriving one from the other by inverting the model is wrong in general, and the ways it is wrong are exactly the ways that matter.

#### Exact reciprocity, and the invariant that survives it

If the fee is a symmetric proportional retention `Γ = 1 − φ` and the curve is smooth, the two directions *are* related at the tangent. Using `h = f⁻¹`, `h'' = −f''/(f')³`:

```
a_r = Γ² / a_f                         ⟹  a_f · a_r = Γ² < 1
B_r = B_f · Γ³ / a_f³                                                   (M8)
```

Note what these say: `a` and `B` are **wildly** asymmetric — `B_r/B_f = (Γ/a_f)³`, three powers of the price. A "symmetric-looking" pool has directional curvatures differing by orders of magnitude whenever the two tokens differ in unit price. Never reuse `B` across directions.

But substitute (M8) into the value conductance `G = ν̂_in · a/B` (M3), evaluated in the pool's own mid frame `ν̂_τ/ν̂_σ = a_f/Γ`:

```
G_f = G_r          exactly                                              (M9)
```

**Value conductance is direction-symmetric.** A resistor is a resistor both ways; all the asymmetry was coordinate change. This is the third independent argument for working in value coordinates (§3.1, Appendix C) — the physical parameter of the arc is frame- and direction-free, and only the chart moves.

#### The asymmetry diagnostic

Rearranging (M8) with `Γ = √(a_f a_r)` gives a test needing no reference prices at all:

```
ASYM_p = log(B_r / B_f) + (3/2) · log(a_f / a_r)        = 0  for any
                                                             smooth symmetric-fee CFMM
```

Zero regardless of curve shape, reserve ratio, or fee level. Nonzero means **genuine** directional asymmetry:

| source | why the directions differ |
|---|---|
| Uniswap v3 | liquidity above and below `slot0.tick` are unrelated; different `L`, different tick counts, different `cap` |
| Curve stableswap | toward the peg is the deep side, away is the shallow side |
| CryptoSwap-NG dynamic fee | one direction rebalances (`Γ_X > 0`), the other imbalances (`Γ_X < 0`) |
| fee-on-transfer tokens | buy tax ≠ sell tax |
| integer rounding | `get_dy(i,j,·)` and `get_dy(j,i,·)` round differently; deployed arithmetic is ordered, not symmetric |

**`CONVEX_FLAG` is per-direction, and generically exactly one of the pair carries it.** On a CryptoSwap-NG pool the rebalancing arc is the non-concave one (§11.2); the imbalancing arc has the fee *rising* with size, so `Γ_X < 0` adds concavity on top of `p_X < 0` and the arc is strictly better behaved than a plain CPMM. Flagging the pool rather than the arc throws away half the routing graph for no reason.

#### Probe economy

Both directions need `a` — pricing-out (§5.5) evaluates `ρ_p` for every arc, so the certificate depends on it. Only the flow-carrying direction needs `B`.

```
per route:        a_f, a_r  (tiny probes)  +  B for the active direction only
per calibration:  full ladder both directions → ASYM, per-direction flags
```

`ASYM` is a validation-time check — run it on new pools, on a schedule, and after any parameter change — not a per-route cost. Use **tangent** values for it: secant fits anchor at `δ̄_f` and `δ̄_r`, which are different points on different curves, so their `G` legitimately differ and (M9) does not apply.

#### Free measurement: the current effective fee

At `δ → 0` both directions see the same balance indicator `k₀`, hence the same retention. So

```
Γ(k₀) = √(a_f · a_r)
```

reads the pool's *current* effective fee straight off two tiny probes — no fee parameters, no `k` computation, no ABI knowledge of the fee law. For a fixed-fee pool it must equal `1 − φ` to full precision; a deviation means the probe pipeline is broken. For a dynamic-fee pool it is the live value, and its drift across blocks is a directly observable signal.

#### The bug this catches: spurious negative 2-cycles

`a_f · a_r = Γ² < 1` is frame-independent — round-tripping a pool always loses. But the linearised drops are frame-*dependent*:

```
ε_f + ε_r = 2 − ( a_f·t + a_r/t ),        t = ν̂_σ / ν̂_τ
```

which is maximal at the pool's own mid `t = √(a_r/a_f)`, where it equals `2(1 − Γ) > 0` — and **falls below zero when `ν̂` is far enough off for this pair.** The model then sees a two-arc negative cycle that does not exist, and allocates flow around it. The quadratic term bounds the damage, but the split is wrong and the certificate is meaningless.

Two defences, both cheap:

1. **Assert `ε_f + ε_r > 0` for every pool** at precompute. Violation means `ν̂` is inconsistent with that pool, not that arbitrage exists. Snap `ν̂_σ/ν̂_τ` toward the pool's own mid, or drop the pool.
2. **Feed both directions into the §4 reference-price fit.** This is not merely tidy — it is what makes the violation rare (see §4).

This also settles the §5.6 assertion. Both directions active simultaneously would require `ε_f + ε_r = 0`; with defence (1) in place that is excluded by construction, so "at most one of each pair is active" becomes a consequence rather than a hope.

---

## 3. Network formulation

### 3.1 Value coordinates

Let `ν̂` be reference prices (§4). Define the value flow through arc `p`:

```
ψ_p = ν̂_{τ(p)} · δ_p
```

**Conductance.**

```
G_p = ν̂_{τ(p)} · a_p / B_p          (M3)
```

i.e. *value scale × token-space conductance*. For a constant-product pool this collapses to a purely observable quantity:

```
G_p = ν̂_y · y₀/2 = TVL_p / 4
```

which recovers the elementary result `R_pool = 4/TVL` — the resistance of a CPMM pool in value units.

**Forward drop.**

```
ε_p = 1 − a_p · ν̂_{σ(p)} / ν̂_{τ(p)}          (M4)
```

If reference prices are arbitrage-consistent and the only friction is the fee, `ε_p = φ_p`. **`ε_p` may be negative** — that is a favourably dislocated pool, an EMF/battery, and it is exactly how arbitrage enters the routing problem. To first order `ε_p ≈ −log(a_p ν̂_σ / ν̂_τ)`, so `ε` is the natural shortest-path edge length (§5.3).

### 3.2 Loss decomposition — the resistor and the diode

Substituting (M1) into `loss_p = ψ_p − ν̂_σ f_p(δ_p)` and using (M3)–(M4):

```
loss_p(ψ_p) = ε_p ψ_p + ψ_p² / (2 G_p)                (M5)
              └ diode ┘   └── resistor ──┘
```

This is exactly the **Cherry content** of a diode-plus-linear-resistor element. The linear term is the fee (constant forward drop, independent of size); the quadratic term is price impact (`½ ψ²/G` = dissipated power). The element law obtained by differentiating and inverting:

```
ψ_p = G_p · ( u_{τ(p)} − u_{σ(p)} − ε_p )₊            (M6)
```

Current flows from high potential to low, dropping `ε_p` across the diode and `ψ_p/G_p` across the resistor. Zero flow until the potential difference exceeds `ε_p` — **this is the origin of sparsity.** With pure resistors every path carries some current; the diode is why real optima activate 3–10 pools out of a thousand rather than smearing across all of them.

### 3.3 Primal — quadratic min-cost flow

```
(P)   min_ψ   Σ_p [ ε_p ψ_p + ψ_p² / (2 G_p) ]
      s.t.    Bᵀ ψ = ŝ
              0 ≤ ψ_p ≤ cap_p
```

where `B ∈ ℝ^{m×n}` has row `p` equal to `e_{τ(p)} − e_{σ(p)}`, and `ŝ = Ψ·e_src − Ψ·e_dst`.

`(P)` is a strictly convex QP over a polyhedron: separable objective, network constraint matrix, box bounds. A **monotropic program** in Rockafellar's sense. It has a unique solution in `ψ`; any correct active-set QP method terminates finitely.

Note conservation here is *lossless in value*: losses are charged in the objective rather than deducted from downstream flow. §3.6 quantifies exactly what this costs.

### 3.4 Dual — a plain graph Laplacian

Lagrangian multipliers `u_t` on the conservation constraints:

```
(D)   max_u   Ψ (u_src − u_dst) − Σ_p (G_p/2) ( u_{τ(p)} − u_{σ(p)} − ε_p )₊²
```

Gauge-fix `u_dst = 0` (the constant vector is the Laplacian's null direction).

Three properties, and each is load-bearing:

1. **Dimension is `n`, not `m`.** ~200 unknowns instead of ~1000+.
2. **`∇D` is the conservation residual.** By the envelope theorem, `∂D/∂u_t = ŝ_t + Σ_{σ(p)=t} ψ_p − Σ_{τ(p)=t} ψ_p`. Setting it to zero *is* Kirchhoff's current law.
3. **`∇²D` is an ordinary graph Laplacian** — symmetric, PSD, sparse:

```
L_A = Σ_{p ∈ A} G_p (e_{τ(p)} − e_{σ(p)})(e_{τ(p)} − e_{σ(p)})ᵀ
```

No arc multipliers, no gain graph. Working in value coordinates rather than token coordinates is precisely what buys this — in token units the incidence rows carry factors `a_p` and the Hessian becomes a gain-graph Laplacian with an `O(θ)` asymmetric correction.

**Stationarity on the active set:**

```
L_A u = ŝ + Bᵀ (G ⊙ ε)                                (M7)
```

with row/column `dst` deleted. `L_A ≻ 0` iff every free node is connected to `dst` through `A` (§9.4).

### 3.5 KKT = Kirchhoff

| KKT condition | Circuit reading |
|---|---|
| `Bᵀψ = ŝ` | KCL — flow conservation at every token |
| `u` exists with (M6) | KVL — potentials are single-valued |
| `ψ_p ≥ 0`, `ρ_p ≤ 0`, complementary | diode: off-arcs are reverse-biased |
| `ψ_p = cap_p` ⟹ `ρ_p ≥ 0` | arc saturated (v3 tick exhausted) |
| strong duality | Tellegen: `ψᵀV = 0` |

Around any cycle, KVL states `Σ(EMFs) = Σ(fees + impact)`: **arbitrage profit is exactly consumed by fees and price impact at the optimum.** Not an approximation — the cycle condition.

### 3.6 Cost of value-lossless conservation

`(P)` charges each arc's loss against the full `ψ` rather than the attenuated flow that actually arrives. For a path of `h` hops with fractional losses `λ_k`:

```
modelled loss = Ψ Σ_k λ_k
true loss     = Ψ [ Σ_k λ_k − Σ_{j<k} λ_j λ_k + O(λ³) ]
```

The model **overstates** loss by `Σ_{j<k} λ_j λ_k` — second order, and *conservative*, which is the correct sign for a router: on-chain reality beats the quote.

| hops | loss/hop | overstatement |
|---|---|---|
| 2 | 30 bp | 0.09 bp |
| 3 | 30 bp | 0.27 bp |
| 3 | 100 bp | 3 bp |
| 4 | 100 bp | 6 bp |

Negligible below ~1 % total loss. Above that, the bias against long paths becomes comparable to real route differences — trigger the correction in §12.3.

---

## 4. Reference prices

`ν̂` is needed to define `G_p` and `ε_p`. Best estimator: **weighted least squares on log-prices**, which is itself one Laplacian solve.

Minimise over `z = log ν̂`:

```
min_z  Σ_p w_p ( z_{σ(p)} − z_{τ(p)} + log a_p )²          ⟹   L_w z = −Mᵀ W log a
```

with `M` the plain incidence matrix, `W = diag(w)`, `L_w = MᵀWM`, and `z_dst = 0`. Weights `w_p = TVL_p` (or `G_p` from a tangent pass) so deep pools dominate and a single manipulated shallow pool cannot move the reference frame.

Properties: robust to inconsistent quotes (it fits the best consistent price system rather than trusting any one path), reuses the same sparse-Cholesky machinery, and the residuals `r_p = z_σ − z_τ + log a_p` are directly the dislocations — large `|r_p|` flags a stale pool or a genuine arbitrage.

**Feed both directions, at half weight.** Include the arc `σ → τ` alongside `τ → σ`, each with weight `w_p/2` so pool influence is not doubled. For a single pool the fit then lands at

```
z_τ − z_σ = ½ ( log a_f − log a_r )
```

which is the **fee-free mid price** exactly: the two one-sided quotes bracket it by `±log Γ`, and the least-squares optimum sits in the middle. Using one direction only biases every reference price to that side of the spread, by `φ` per arc, systematically.

This matters beyond tidiness. §2.6 shows a mis-estimated `ν̂` can manufacture a negative 2-cycle (`ε_f + ε_r < 0`) that the solver will route around. The pool's own mid is precisely the frame that *maximises* `ε_f + ε_r`, so a mid-centred fit is the configuration in which the spurious cycle is hardest to produce. The assertion in §2.6 remains as a guard; this makes it rarely fire.

An external oracle can substitute, but the LS fit is preferable: it is *internally* consistent with the pool set being routed over, which is what `ε_p` measures against.

---

## 5. Algorithm

### 5.1 Overview

```
ROUTE(pools, src, dst, X) →  flow ψ*, certificate, N candidates

 1  ν̂     ← reference_prices(pools, dst)                        # 1 Laplacian solve
 2  a,B   ← calibrate(pools, ν̂, X)                              # M2, vectorised
 3  G,ε   ← M3, M4
 4  S     ← seed_subgraph(src, dst, ε, G)                        # k-shortest + top-G
 5  repeat
 6      ψ*,u* ← active_set_solve(S, G, ε, ŝ)                     # M7 per pivot
 7      ρ     ← u*[τ] − u*[σ] − ε                                # O(m), all pools
 8      V     ← { p ∉ S : ρ_p > tol }
 9      S     ← S ∪ V
10  until V = ∅                                                  # ⟹ CERTIFICATE
11  cands ← generate_candidates(ψ*, S, …)                        # §6
12  quotes← multicall_verify(cands, block)                       # §7
13  refit + re-solve on the winner                               # §8
14  return best exact-verified flow
```

### 5.2 Precompute — `O(m)`, vectorised

Everything is array work over pools: token index maps, incidence `(τ, σ)`, `a`, `B`, `G`, `ε`, `cap`. Build CSR incidence once. Cache and invalidate per block on reserve updates.

### 5.3 Seed subgraph

Union of:

- `k`-shortest `src → dst` paths on edge length `ε_p` (Yen or Eppstein), `k ≈ 10`.
- Top-`G` arcs incident to any node touched by those paths (breadth, not depth).
- Any negative cycle in `ε` reachable from the path set — that is free arbitrage the router should absorb.

Because `ε_p` can be negative, use Bellman–Ford / SPFA rather than Dijkstra, or shift by `min(0, min_p ε_p)` and correct. In the common case where `ν̂` came from §4 with small residuals, `ε ≥ 0` almost everywhere and Dijkstra with a negative-arc fallback is faster.

Seed quality only affects the number of column-generation rounds, never correctness — the certificate in §5.5 is what guarantees the answer.

### 5.4 Active-set solve

Three sets: `A` (free, `0 < ψ < cap`), `Z` (at zero), `U` (at capacity).

```
solve_active(S, G, ε, ŝ):
    A ← arcs on the best seed path
    Z ← S \ A ;  U ← ∅
    loop:
        rhs ← ŝ + Bᵀ(G⊙ε) − B_Uᵀ ψ_U          # saturated arcs move to rhs
        u   ← chol_solve(L_A, rhs)             # M7, ground u_dst = 0
        ψ_A ← G_A ⊙ (B_A u − ε_A)

        if ∃ p∈A with ψ_p < 0:      move most-negative p to Z ;  downdate ;  continue
        if ∃ p∈A with ψ_p > cap_p:  move most-violating p to U ; downdate ;  continue
        ρ ← B u − ε
        if ∃ p∈Z with ρ_p > tol:    move max-ρ p to A ; update ; continue
        if ∃ p∈U with ρ_p < −tol:   move min-ρ p to A ; update ; continue
        return ψ, u
```

Each pivot is a **rank-1 Cholesky update or downdate**, not a refactorisation. Typical: 3–8 pivots.

**Finite termination.** `(P)` is a strictly convex QP over a polyhedron and the objective strictly decreases on each pivot, so cycling cannot occur under a consistent tie-break. Use Bland's rule (lowest index among violators) if a repeated basis is ever detected; in practice degeneracy shows up only with exactly-duplicate pools, which should be merged in preprocessing (§9.5).

**Warm start.** The very first solve — all arcs active, conductance from the tangent fit — is the pure `(f', f'')` answer and is exact in the small-trade limit. Everything after it is correcting for the diode combinatorics.

Alternative for the pragmatic path: `(P)` is a bog-standard convex QP; OSQP or Clarabel will solve it directly. Expect ~10× slower than the Laplacian active-set method, but it is a good reference implementation to validate against.

### 5.5 Column generation and the certificate

> **Theorem (optimality certificate).** Let `(ψ*, u*)` solve the subproblem restricted to `S`. If
> ```
> ρ_p = u*_{τ(p)} − u*_{σ(p)} − ε_p ≤ 0    for all p ∉ S
> ```
> then `ψ*` extended by zero is the global optimum of `(P)` over **all** `m` pools.

*Proof.* `ψ_p = 0` with `ρ_p ≤ 0` satisfies complementary slackness for arc `p`; conservation and the element law already hold on `S`; `(P)` is convex, so KKT is sufficient. ∎

This is the scaling result. Pricing out is one vectorised pass — `n`-indexed gather, subtract, compare — over `m` pools, and it *proves* optimality without ever forming those arcs' contributions to the Laplacian. Typical: 2–4 rounds, final `|S| ≈ 30–60` out of 1000.

### 5.6 Primal recovery and path decomposition

```
δ_p = ψ_p / ν̂_{τ(p)}
```

Then flow-decompose `ψ*` into paths for calldata (standard: repeatedly extract the max-bottleneck `src → dst` path, subtract, until residual is zero). At most `|A|` paths, in practice 3–10.

**Do not undo the netting.** If two decomposed paths traverse the same pool, that pool must see the *net* flow. The edge-flow formulation handles this automatically; path-based routers double-count impact here and it is a common source of failed quotes.

---

## 6. Candidate generation

### 6.1 The flatness argument, and its precondition

At the optimum all active pools have equal marginal rate, so output is **first-order flat in the split ratios**. Perturbing an allocation by `Δ` costs `≈ ½Δ² Σ 1/G_p` — nothing. Wei-rounding, bp-quantised splits, and several bp of `θ²` error in the ratios are all free.

**Active-set error is first-order.** Including a pool that should not be there, or missing one, costs linearly.

> **Precondition.** Ratio-flatness holds at a smooth interior optimum of a *concave* problem — equivalently, **iff no `CONVEX_FLAG` arc is active**. When a flagged arc carries flow, the true objective may have an interior maximiser in the split ratio that the concave relaxation has replaced by a chord (§11.2). There the active set can be identical across allocations while the ratio alone is worth basis points.

So: if no arc is flagged, diversify in active set only (§6.2). If any active arc is flagged, add a ratio sweep on that arc (§6.3).

### 6.2 Active-set diversity (default path)

```
C₀   full solution ψ*
C_i  drop arc i, re-solve            for each i ∈ A        (rank-1 downdate, ~µs)
C_*  best single path, no splitting  (robust fallback)
C_s  swap: force out the smallest-ψ arc, force in the best-ρ inactive arc
```

`N ≈ 10–15`. These are simultaneously the **gas-sparsification candidates** — dropping an arc is exactly the greedy gas move — so one multicall answers both "which active set is truly best" and "is the extra hop worth its gas." No separate greedy loop is needed.

### 6.3 Pin-and-resolve ratio sweep (flagged arcs)

For each active flagged arc `p`, pin `ψ_p` at a ladder of values and re-solve the rest of the network at each pin. **No new machinery is needed**: pinning moves `p` into the `U` set of §5.4, where it contributes `−B_pᵀψ_p` to the right-hand side — the same mechanism already implemented for saturated v3 tick arcs.

```
pins ← ψ_p* · {0, ⅛, ¼, ½, 1, 2, 4}  ∩ [0, cap_p]        # log-spaced, straddling ψ_p*
for each pin:
    U ← U ∪ {p} with ψ_p = pin
    re-solve (rank-1 downdate + one Cholesky, ~µs)
    emit as candidate
```

Each pin gives the **exact restricted optimum of everything else, given that pin** — so the sweep brackets a chord interior without ever constructing the hull, computing a support function, or running a resultant. It is a coarse search that the multicall then adjudicates exactly.

Cost: 6–7 extra candidates per flagged arc; flagged arcs should number in the low single digits. Budget `N ≈ 30–40` multicall entries in the worst case.

**Why a sweep and not endpoints.** The concave-envelope construction produces a chord `[a, b]` and it is tempting to test only `a` and `b`. That is provably insufficient — see §11.2 for the mechanism and a worked counterexample where both endpoints lose to an interior point by ≈ 0.5 bp.

---

## 7. On-chain verification

Split by whether the math is replicable off-chain:

| Pool | Call | Rationale |
|---|---|---|
| v2, Curve stable/crypto | read state (`getReserves`, `balances`, `A`, `gamma`, `D`) | cheaper than a quoter, and returns the **whole curve** — refit `(a,B)` exactly at any size |
| v3 | `slot0` + `liquidity` + tick bitmap window, or `QuoterV2` | quoter is ~120 k gas/hop and non-`view` (reverts internally); prefer state if you walk ticks yourself |
| v4 hooks, PMM / RFQ | quoter only | not replicable |

Four rules:

1. **Net shared pools before quoting.** `get_dy` is a pure view and cannot see the other leg. If a candidate touches pool `P` twice, quote the net.
2. **Pin the block.** All candidates at the same `blockNumber`, or the winner is noise.
3. **Quote at `δ_p` and `1.01·δ_p`.** One extra call per pool yields the realised secant slope → live `f''` at the true operating point → refit and re-solve (§8). Two round trips total, second solve on the true curve.
4. **`aggregate3` with `allowFailure: true`.** Treat a failed quote as **arc removal**, then re-solve — not as an error.

What the multicall catches that no amount of math will: paused pools, reentrancy locks, fee-on-transfer and rebasing tokens breaking conservation, hooks quoting differently from their pool math, and stale indexer state. This is most of the real-world value.

**Slippage.** Global `minOut` on the final output, never per-leg — per-leg bounds compound and revert on benign reordering. Because the quote is verified rather than modelled, tolerances can be tight: 1 bp on stable↔stable legs, and no need to absorb model error into slippage.

---

## 8. Refit loop

```
for round in 1..2:
    quote δ_p and 1.01 δ_p on-chain for all p ∈ A
    a_p ← quoted marginal at δ_p
    B_p ← 2 (a_p δ_p − f_p(δ_p)) / δ_p²            # secant refit, M2
    recompute G_p, ε_p ;  re-solve (warm start from previous u)
    if max_p |Δψ_p| / Ψ < 10⁻⁴: break
```

Converges in 2 rounds essentially always, because the refit is a fixed point in a quantity (`B_p`) that varies slowly with `δ_p`.

---

## 9. Numerics

**9.1 Fixed point.** Work in `float64` for the solve, integers for calldata. `ν̂` normalised so the numéraire is `1` and typical `ψ_p ∼ 1`; otherwise `G_p` spans 10+ orders of magnitude (dust pool vs. 100 M pool) and the Laplacian conditions badly. Scale `G` by its median before factorising.

**9.2 Tolerances.** `tol` for reduced costs should be an absolute value in the same units as `ε` — use `10⁻⁹` (0.00001 bp), well below any real fee. Never a relative tolerance: `ρ_p` legitimately passes through zero.

**9.3 Linear solver.** Sparse Cholesky (CHOLMOD via `scikit-sparse`, or `splu` on the SPD system) with AMD ordering. At `n ≈ 200` this is microseconds. Rank-1 up/downdate for pivots. Only past `n ≈ 10⁵` should you switch to CG with a spanning-tree or incomplete-Cholesky preconditioner.

**9.4 Connectivity and grounding.** Delete row/column `dst`. Then `L_A ≻ 0` iff every remaining node is connected to `dst` through `A`. Enforce by restricting the system to the connected component of `dst` at each pivot; isolated nodes carry `ψ = 0` by construction and can be dropped. Failing to do this produces a singular factorisation on the first pivot that disconnects a leaf.

**9.5 Degenerate pools.** Merge exact duplicates (same `τ, σ`, same `a`, same `B`) into one arc with `G = ΣG` before solving — parallel resistors — and split the resulting flow proportionally to `G` afterwards. This removes the main source of active-set cycling and reduces `m`.

**9.6 Dust.** Drop arcs with `G_p < 10⁻⁶ Ψ` at precompute. They can never carry meaningful flow and only add pivots.

**9.7 Conductance ceiling.** Clamped-curvature arcs (§2.3) would otherwise carry `G_p → ∞`. Ceiling at `10³ · max{G_q : q unflagged}`, *after* the §9.6 dust floor, so the total spread in `G` — and hence the Laplacian condition number — stays around `10⁹`. Never implement the clamp as a floor on `B_p`: `G = ν̂a/B` turns a `10⁻³⁰` floor into a `10³⁰` conductance and the factorisation is worthless. Assert `max(G)/min(G) < 10¹²` after precompute; if it trips, something is being clamped in the wrong space.

---

## 10. Complexity

| Stage | Cost | Notes |
|---|---|---|
| Precompute + calibration | `O(m)` | vectorised, embarrassingly parallel |
| Reference prices | one sparse Cholesky, `O(n^1.5)` | reusable across many routes in a block |
| Seed | `O(k(m + n log n))` | Yen's algorithm |
| Per pivot | rank-1 update, `O(nnz)` | 3–8 pivots typical |
| Pricing out | `O(m)`, SIMD | per column-generation round |
| Rounds | 2–4 | |
| Candidates | `N` × rank-1 downdate | ~µs each |
| Multicall | 1–2 RPC round trips | dominates wall-clock |

Off-chain total is sub-millisecond at `n ≈ 200`, `m ≈ 10³`. **The RPC round trip is the bottleneck**, which is the correct place for it to be.

---

## 11. Failure modes and scope

### 11.1 Gas — outside the convex core

A fixed cost per arc is not an element law; it is a combinatorial term on the graph, non-convex by construction, with no network-theoretic analogue. It must not enter `(P)`. Handle it in candidate selection (§6): each `C_i` already has one fewer arc; pick the candidate maximising `verified_output − gas_cost`.

### 11.2 Non-concave arcs — certificate void, and endpoint testing is *not* a fix

Size-*decreasing* effective fees, rebate tiers, discrete RFQ ladders, and CryptoSwap-NG dynamic fees on the rebalancing side: `f_p` is no longer concave, the element law is no longer monotone, Minty's theorem fails, uniqueness is lost, and §5.5 proves nothing.

**Circuit reading.** A trade that rebalances the pool raises `k`, raises `w(k)`, raises `Γ` — so `Γ_X > 0` and the effective fee *falls with size*. Increasing returns; locally negative differential resistance. This is a **tunnel diode**, and the classic symptom follows: multiple operating points, with the concave hull's chord playing the role of the load line across the NDR region.

#### Why more probes do not close the hole

Three `get_dy` calls do capture the dynamic-fee dependence — the sampled values include `Γ(k(X))`, so `f'''` estimated from them is informative about the real curve. The obstruction is not fidelity, it is **admissibility**:

- if the fit reports `f'' > 0` anywhere in range, then `G_p = ν̂ a/B < 0` — a negative resistor. `L_A` stops being PSD, the Cholesky fails or returns garbage, and the certificate is void.
- so probes either **miss** the defect (same wrong answer) or **catch** it (solver inadmissible). A more faithful local model makes the second branch *more* likely.

There is no Taylor order that is simultaneously faithful to increasing returns and admissible in a convex program. Hence §2.3: the ladder is a detector.

#### Why endpoint testing fails

Let arc 1 be flagged with hull chord `[a, b]`, and let the rest of the network present effective response `B₂`. The envelope replaces `B₁` by an affine majorant on `(a, b)`, but the *raw* objective differs from that majorant by a nonconstant gap while `B₂(D_G − G)` is also non-affine. So

```
d/dG [ B₁(G) + B₂(D_G − G) ] = m₁(G) − m₂(D_G − G)
```

can vanish at an interior raw state, with `m₁'(G) + m₂'(D_G − G) < 0` there **even where `m₁' > 0`**. Nothing forces the maximiser to an endpoint.

**Worked counterexample** (CryptoSwap-NG split math, §8):

```
Twocrypto  N=2, a=500, g=0.013, balanced start, D=2,000,000,
           ε=1e-8, midFee=0.0002, outFee=0.0102, new fee law
v3 lane    L=10,000,000, retention=0.9995
chord      [101.825830, 10860.885491], slope 0.989710375174
budget     54,841
```

| allocation | output |
|---|---|
| chord endpoint `a` | 54,515.382514 |
| chord endpoint `b` | 54,515.378409 |
| **interior, Crypto input 5,690** | **54,518.115028** |
| relaxed hull upper bound | 54,518.229103 |

The interior point beats both endpoints by **> 2.7 units, ≈ 0.5 bp** — orders of magnitude above binary64 noise. Note the chord spans two decades in input *because* the defect is sharp: the fee weight is a near-step in `k`, so the hull bridges a narrow notch but lands tangent far away on both sides. This is also why a local probe ladder cannot see it (§2.3).

Note the relaxation itself is *tight* — the bound is 0.11 units above the achieved optimum. What fails is rounding to chord endpoints, not the relaxation.

#### Mitigation

1. **Flag** the arc (§2.3): numeric divided-difference test **or** structural test on pool metadata.
2. **Clamp to zero curvature, with a chord and a cap** (§2.3). `B_p = 0` is the admissible limit — a linear arc, no impact — and it is the local concave envelope, so the solve optimises a relaxation with a known-tight bound. Replace `a_p` by the chord slope, cap the arc at the end of the convex region, and ceiling `G_p` in conductance space rather than dividing by a near-zero `B_p`.
3. **Ratio-sweep** the arc by pin-and-resolve (§6.3) and let the multicall adjudicate. This is the fast-and-probe path: no hull construction, no support function, no resultants on the hot path.
4. **Report `certificate = False`.** The answer is typically good and often exact; it is not proven optimal.

Steps 3–4 are not belt-and-braces. Because the clamp makes a flagged arc look *bottomless*, it will typically be selected rather than discarded, so the sweep and the on-chain verification are the only things standing between the relaxation and the quote.

*Optional hardening, off the hot path.* The certified sign partition of `m` and `m_X` (resultants + Sturm chains + Bernstein signs) depends only on the normalized tuple `(N, a, g, ε, midFee, outFee)`, and deployed pools share a small set of these. Precompute the partition once per tuple, store as a table in normalized `(X, k)` space, and route-time cell membership becomes an `O(1)` lookup. This converts an exact-but-expensive certificate into a free flag. Recommended only if flag false-positive rate becomes a problem in production — the probe path is cheaper and sufficient.

### 11.3 A pool genuinely hit too hard

If `θ_p` exceeds ~3 % after refit, switch *that arc only* to the power-law element law, which is exact for the whole family `x^{w_x} y^{w_y} = k`:

```
η = f' f''' / (f'')²     (constant per family; = 3/2 for CPMM)
p = 1/(η−1) ,  s = p·a/B
f'(δ) = a (1 + δ/s)^{−p}
δ*(r) = s [ (a/r)^{1/p} − 1 ]
```

Same two parameters `(a, B)`, one `pow` per evaluation, exact at any size, no wall, concavity preserved. The arc becomes a nonlinear resistor: keep the Laplacian as the Newton matrix and add 3–5 damped Newton iterations on that small active set. This strictly dominates adding a cubic term.

### 11.4 Fee-on-transfer / rebasing tokens

Break token conservation, which is an assumption of `(P)` itself, not of the quadratic model. Detect at multicall (quoted output ≠ balance delta) and either exclude the token or model the transfer tax as an extra `ε` on every incident arc.

### 11.5 Time

The network here is purely dissipative — no reactive elements, no memory — because pool state is frozen during the trade. Routing across blocks or against time-varying reserves adds state and leaves resistive-network territory entirely. Out of scope.

One consequence of time does have to be priced, though, and like gas it is priced *outside* `(P)` (§11.1). Each leg executes with a minimum-out — a fraction of that pool's fee, the level at which sandwiching stops paying, floored at 5 bp on arcs whose own rate is measured to move — and that bound is also a revert trigger: the route lands only if every pool it touches stays inside its own bound during the minute or two between the quote and inclusion. `P(fails) = 1 − Π(1 − pᵢ)`, with `pᵢ` measured per arc (`dev/revert_risk.py`, stored in `data/facts`).

**A failure costs a resubmission, not the trade**, and that fixes the scale of the whole term. Candidate selection maximises

```
verified_output × (1 − P(fails) × REVERT_COST_BP/1e4) − gas_cost × (1 + P(fails))
```

with `REVERT_COST_BP ≈ 1`: gas, plus whatever the price did while the user resubmitted. Ranking on `output × Π(1 − pᵢ)` instead — pricing a failure as losing the entire notional — was measured to pay 17–126 bp for safety on volatile pairs and to flip between routes 1–20% apart in price on nothing but which candidates a given run generated. The gas term keeps its own `(1 + P(fails))` because a failed attempt pays for itself and the retry pays again.

This is a term on the *candidate*, not an element law: it is a function of the chosen arc set, so it is no more admissible inside the convex program than a fixed per-arc cost is, and for the same reason. It also replaces any notion of a leg budget. Measured, `pᵢ` is not a property of the asset class — Yield Basis WETH is maximally volatile and never breaches, because its 218 bp fee puts the bound at 43.7 bp, while TriCRV's 3.36 bp fee gives a 0.77 bp bound against a rate that moves several bp a minute and breaches around 40% of the time — so a leg budget prices exactly the wrong thing. Nine arcs in ten never breach, and the ones that do are worth a fraction of a basis point each, which separates two otherwise equal routes and never buys a materially worse price.

### 11.6 What is deliberately not used

**Path enumeration.** Exponential, and it double-counts impact on shared pools.

**Chunked DP** (discretise `X` into `N` parts, DP over chunks × tokens). `O(N²E)`, coarse in split ratios, no certificate — but it eats gas and non-concavity without complaint. **Keep it in shadow mode** as a cross-check (§13.3), not on the hot path.

---

## 12. Diagnostics and invariants

Compute these every route; they are cheap and they are how the system tells you it is being used outside its assumptions.

**12.1 Size check.** `θ_p = δ_p / y_p` for each active pool. If `max θ_p > 3 %`, recalibrate that arc by secant at the realised size and re-pivot. If still `> 10 %`, escalate to §11.3.

**12.2 Curvature check.** All three numbers come free from the §2.3 probe ladder — no extra RPC.

| quantity | healthy | action otherwise |
|---|---|---|
| `CONVEX_FLAG_p` | false | clamp `B_p > 0`, ratio-sweep (§6.3), `certificate = False` |
| `DRIFT_p = D₂/D₁ − 1` | \|·\| < 0.25 | recalibrate at realised size; if persistent, split the arc (§2.5) |
| `η_p = 3 a_p D₃ / (2 D₂²)` | `≈ 1.5` (CPMM), `∈ (1,2)` (weighted) | outside `(1,2)` or unstable under small `δ` ⟹ **non-smooth feature nearby; split the arc** |

`DRIFT` is the direct measurement of the one assumption the whole solver rests on. `η` is the family fingerprint — one division, and the single most informative number in the system.

**12.2c Direction check.** Per pool, not per arc. All free from tangent probes.

| quantity | expected | action otherwise |
|---|---|---|
| `a_f · a_r` | `= Γ(k₀)² < 1` | `≥ 1` ⟹ broken quote or stale state; drop the pool |
| `√(a_f · a_r)` | `= 1 − φ` for fixed-fee pools | deviation ⟹ probe pipeline bug; for dynamic-fee pools this is the live effective fee, log it |
| `ε_f + ε_r` | `> 0` | ⟹ `ν̂` inconsistent with this pool; snap to pool mid or drop (§2.6) |
| `ASYM_p` | `≈ 0` | ⟹ real directional asymmetry; calibrate `B` per direction, never by (M8) |

Report `CONVEX_FLAG`, `DRIFT`, `η` and `θ` **per arc**, not per pool. On a dynamic-fee pool the two directions routinely disagree — one arc flagged, the other strictly better-conditioned than a CPMM — and averaging them destroys the only information that matters.

**12.2b Chord check.** If any `CONVEX_FLAG` arc is active in the winning candidate, record `chord_active = True`. Downstream consequences: §6.1's flatness argument does not hold, the §5.5 certificate is void, and the reported output is a lower bound on a relaxation whose upper bound is `Σ H_i(μ) + μ D_G` — worth logging alongside, since a tight gap means the sweep found the true optimum and a wide one means it did not.

**12.3 Loss check.** If total modelled loss `> 1 %`, the value-lossless approximation (§3.6) is biting. Forward-propagate exact `f_p` in topological order, recalibrate each arc at its realised flow, re-solve. Two rounds.

**12.4 Invariants (assert in tests, log in production).**

```
KCL         ‖Bᵀψ − ŝ‖∞ / Ψ                   < 10⁻¹⁰
complement  ψ_p · ρ_p                        ≈ 0     ∀p
sign        ψ_p ≥ 0,  ρ_p ≤ tol ∀p∉A
duality     primal loss − dual value         < 10⁻⁹ Ψ
model       δ_p ≤ a_p/B_p                    ∀p       (M1 domain)
admissible  G_p > 0                          ∀p       (else Laplacian not PSD)
clamped     B_p == 0  ⟹  cap_p < ∞           ∀p       (else flow unbounded)
condition   max(G)/min(G)                    < 10¹²   (clamp done in G-space)
certificate max_{p∉S} ρ_p ≤ tol  AND  no active arc flagged
sweep       flagged active arc ⟹ ≥ 5 pins evaluated in the multicall
```

---

## 13. Testing

**13.1 Analytic.**

- *Single pool.* `δ = X`, `u_src = (a − BX)`-equivalent; dual value equals `aX − ½BX²`. Verifies grounding and strong duality.
- *Two pools in parallel, equal `a`.* Split must be exactly `∝ G_p`, i.e. `∝ 1/B_p`, i.e. `∝ TVL` for CPMM. Verifies conductance and the parallel law.
- *Two pools in series.* `u` at the intermediate node must equal the marginal rate implied by the realised second-hop size. Verifies KVL and topological ordering.
- *Diode.* Two parallel pools, identical `G`, `ε₂ = ε₁ + 10⁻⁴`. For small `X`, pool 2 must carry exactly zero; there is a threshold `X` above which it activates. Verifies complementarity — the property most likely to be silently broken by a refactor.
- *Battery.* One pool with `ε_p < 0`. The router must route through it even when it is off the direct path.
- *Reciprocity.* On a plain CPMM with `x₀ ≠ y₀`: assert `a_f·a_r = Γ²` to machine precision, `B_r = B_f Γ³/a_f³`, `G_f = G_r`, and `ASYM = 0`. Then assert `B_f ≠ B_r` by orders of magnitude — a test that passes trivially on a balanced 1:1 pool is worthless, so use `x₀/y₀ = 3000`.
- *Direction split under dynamic fee.* A CryptoSwap-NG pool off balance: exactly one of the two arcs must carry `CONVEX_FLAG`, and it must be the rebalancing one. Both flagged, or neither, is a bug in the structural test.
- *Spurious 2-cycle.* Perturb one token's `ν̂` by 10× and assert the `ε_f + ε_r > 0` guard fires rather than the solver routing around the fake cycle. Then assert the §4 both-directions fit does not produce the perturbation in the first place.
- *Clamp is an upper bound.* On a synthetic arc with a convex region, assert the clamped model's output ≥ true output on `[0, cap]`, with equality at both endpoints. Then assert the **tangent** variant (`a` left at `f'(0)`) violates this — that is the bug the chord rule exists to prevent, and it is invisible without the test.
- *Unbounded flow.* Two clamped arcs forming a cycle with total `ε < 0`, caps removed. The solver must fail the §12.4 `clamped ⟹ cap < ∞` assertion at precompute, not produce a large finite answer.
- *Conditioning.* Assert `max(G)/min(G) < 10¹²` after precompute on a graph containing at least one clamped arc. Flooring `B` instead of ceilinging `G` fails this by ~18 orders of magnitude while still returning a plausible-looking route — the reason it is an assertion and not a code review item.
- *Chord (regression, must not silently pass).* The CryptoSwap-NG + v3 configuration of §11.2 at budget 54,841. The §6.2 active-set generator alone returns ≈ 54,515.38 — the active set is *identical* across the endpoint allocations, so no drop-an-arc candidate can find the gap. With §6.3 pinning enabled the sweep must bracket Crypto input 5,690 and the multicall must return ≥ 54,518.11. This test is the reason §6.3 exists; it fails silently without it, which is the worst failure mode in the system.

**13.2 Property / fuzz.** Random graphs, random `(a, B)`; check every invariant in §12.4; check that route output is monotone non-decreasing in `X` and concave in `X`; check that adding a pool never decreases optimal output.

**13.3 Differential.** Against exact `f_p` evaluated on the returned flow: the modelled output must be **conservative** (`modelled ≤ exact` after tangent fit). Against chunked DP with `N = 1000`: agreement within the discretisation bound. **A disagreement beyond that bound means the `f''` model is wrong for some pool, not that the solver is wrong** — check §12.2 first.

**13.4 Replay.** Historical blocks, compare verified output against what production routers actually achieved. This is the only test that catches calibration bias.

---

## 14. Reference implementation

```python
import numpy as np
import scipy.sparse as sp
from scipy.sparse.linalg import splu

# ---------------------------------------------------------------- graph
# tau, sig : int arrays, length m   (in-token idx, out-token idx)
# a, B     : float arrays, length m (marginal rate at 0, |f''|)
# cap      : float array or +inf

def incidence(tau, sig, n, rows=None):
    """B[p,:] = e_tau - e_sig, restricted to `rows` if given."""
    idx = np.arange(len(tau)) if rows is None else rows
    k = len(idx)
    data = np.concatenate([np.ones(k), -np.ones(k)])
    r = np.concatenate([np.arange(k), np.arange(k)])
    c = np.concatenate([tau[idx], sig[idx]])
    return sp.csr_matrix((data, (r, c)), shape=(k, n))


def laplacian(Bm, G, ground):
    """L = Bᵀ diag(G) B with row/col `ground` deleted."""
    L = (Bm.T @ sp.diags(G) @ Bm).tocsr()
    keep = np.setdiff1d(np.arange(L.shape[0]), [ground])
    return L[keep][:, keep], keep


# ------------------------------------------------- §4 reference prices
def reference_prices(tau, sig, a, w, n, numeraire):
    """min_z Σ w_p (z_sig - z_tau + log a_p)²  →  weighted Laplacian solve."""
    M = incidence(sig, tau, n)                       # +1 at sig, -1 at tau
    L, keep = laplacian(M, w, numeraire)
    rhs = -(M.T @ (w * np.log(a)))[keep]
    z = np.zeros(n)
    z[keep] = splu(L.tocsc()).solve(rhs)
    return np.exp(z)


# ------------------------------------------------------- §3.1 M3 / M4
def arc_params(tau, sig, a, B, nu):
    G   = nu[tau] * a / B                            # (M3)
    eps = 1.0 - a * nu[sig] / nu[tau]                # (M4)  may be < 0
    return G, eps


# ------------------------------------------------- §5.4 active-set solve
def active_set_solve(tau, sig, G, eps, cap, n, src, dst, Psi,
                     A0=None, tol=1e-9, maxit=200):
    m = len(tau)
    s_hat = np.zeros(n); s_hat[src] = Psi; s_hat[dst] = -Psi

    A = np.zeros(m, bool); U = np.zeros(m, bool)
    if A0 is not None: A[A0] = True
    if not A.any(): A[:] = True                      # warm start: all arcs

    Bfull = incidence(tau, sig, n)
    psi = np.zeros(m); u = np.zeros(n)

    for _ in range(maxit):
        idx = np.flatnonzero(A)
        if len(idx) == 0: break
        Bm = Bfull[idx]
        L, keep = laplacian(Bm, G[idx], dst)
        rhs = (s_hat + Bfull.T @ np.where(A, G * eps, 0.0)
                     - Bfull.T @ np.where(U, cap, 0.0))[keep]
        u = np.zeros(n)
        u[keep] = splu(L.tocsc()).solve(rhs)         # (M7)

        psi = np.zeros(m)
        psi[U] = cap[U]
        psi[idx] = G[idx] * (Bm @ u - eps[idx])
        rho = u[tau] - u[sig] - eps                  # reduced costs

        neg = idx[psi[idx] < -tol]
        if len(neg): A[neg[np.argmin(psi[neg])]] = False; continue
        hit = idx[psi[idx] > cap[idx] + tol]
        if len(hit):
            j = hit[np.argmax(psi[hit] - cap[hit])]; A[j] = False; U[j] = True; continue
        Z = ~A & ~U
        if Z.any() and rho[Z].max() > tol:
            A[np.flatnonzero(Z)[np.argmax(rho[Z])]] = True; continue
        if U.any() and rho[U].min() < -tol:
            j = np.flatnonzero(U)[np.argmin(rho[U])]; U[j] = False; A[j] = True; continue
        break

    return psi, u, A


# ------------------------------------------------ §5.5 certificate check
def price_out(u, tau, sig, eps, in_S, tol=1e-9):
    """Returns violating arcs outside S; empty ⟹ global optimality."""
    rho = u[tau] - u[sig] - eps
    return np.flatnonzero((~in_S) & (rho > tol))


# --------------------------------------------- §2.3 probe ladder + detector
def calibrate(quotes, d_bar, eps_frac=1e-6, structural_flag=False,
              drift_tol=0.25, f_at_cap=None, cap=None):
    """quotes = f(δ) at [δ_ε, d_bar/4, d_bar/2, d_bar];  f(0)=0 is free."""
    f_eps, f1, f2, f3 = quotes
    x = np.array([0.0, d_bar / 4, d_bar / 2, d_bar])
    y = np.array([0.0, f1, f2, f3])

    a = f_eps / (d_bar * eps_frac)                   # marginal at zero
    B = 2 * (a * d_bar - f3) / d_bar**2              # (M2) secant fit

    d1 = np.diff(y) / np.diff(x)                     # 1st divided differences
    D1, D2 = np.diff(d1) / (x[2:] - x[:-2])          # 2nd   (M2b)
    D3 = (D2 - D1) / (x[3] - x[0])                   # 3rd

    flag = bool(structural_flag or D1 > 0 or D2 > 0
                or np.sign(D1) != np.sign(D2))
    drift = D2 / D1 - 1.0 if D1 != 0 else np.inf
    eta = 3 * a * D3 / (2 * D2**2) if D2 != 0 else np.nan

    clamped = B <= 0.0
    if clamped:                                      # §2.3 zero-curvature clamp
        assert cap is not None and np.isfinite(cap), \
            "clamped arc needs a finite cap: flow is otherwise unbounded"
        a = f_at_cap / cap                           # CHORD, not tangent
        B = 0.0                                      # ceilinged in G-space later

    return dict(a=a, B=B, cap=cap, clamped=clamped,
                convex_flag=flag or clamped, drift=drift, eta=eta,
                split_hint=bool(abs(drift) > drift_tol))


def ceiling_conductance(G, flagged, factor=1e3):
    """§2.3 rule (3) / §9.7. Clamp in G-space; never floor B."""
    ref = G[~flagged & np.isfinite(G)].max()
    return np.minimum(np.where(np.isfinite(G), G, np.inf), factor * ref)


# ------------------------------------------------ §6.3 pin-and-resolve sweep
def pin_sweep(p, psi_star, cap, solve_fn, ladder=(0, .125, .25, .5, 1, 2, 4)):
    """Pin arc p at each level, re-solve the rest. Reuses the U set of §5.4."""
    out = []
    for s in ladder:
        pin = min(s * psi_star[p], cap[p])
        if s > 0 and pin <= 0:
            continue
        out.append(solve_fn(forced_upper={p: pin}))   # p → U, moves to rhs
    return out
```

Notes for an implementing agent:

- `laplacian` refactorises every pivot. Production must replace this with CHOLMOD rank-1 `update`/`downdate`; the structure above is written for clarity and for use as the differential-test oracle.
- `A0=None` starting from all-arcs-active is the tangent warm start of §5.4. Seeding from the best shortest path instead typically halves the pivot count.
- `cap` defaults to `+inf` for non-v3 arcs; pass a real array to enable §2.5 tick splitting.
- Bidirectional pools appear as two arcs; assert post-solve that at most one of each pair is active.
- **The clamp in `calibrate` is load-bearing, not cosmetic.** A negative `B` yields `G_p < 0`, an indefinite Laplacian, and a Cholesky that either fails or returns nonsense. But do it in *conductance* space (`ceiling_conductance`), not by flooring `B` — a `10⁻³⁰` floor becomes a `10³⁰` conductance and ruins the factorisation for every other arc in the graph.
- **The `cap` assertion is not defensive.** A clamped arc has no self-limiting term; without a finite cap, a cycle with negative total `ε` gives unbounded flow. Fail loudly at calibration rather than silently in the solve.
- **`f_at_cap` costs one extra probe** on flagged arcs only, and it is what turns the tangent (under-estimate, can silently skip the arc) into the chord (upper bound, cannot prune the optimum).
- `pin_sweep` needs `solve_fn` to accept `forced_upper` — that is the same code path as a saturated v3 tick arc, so if §5.4 is implemented correctly this is a keyword argument, not a new branch.

---

## 15. Interfaces

```
PoolArc:
    id: bytes32          # pool address + direction + (tick index if split)
    tau, sigma: uint     # token indices
    a: float             # f'(0⁺), fee included
    B: float             # |f''|, secant-fit at expected size; clamped > 0
    cap: float           # +inf, or L·Δ√p for a v3 tick arc
    kind: enum           # V2 | V3_TICK | STABLE | WEIGHTED | CRYPTOSWAP | PMM
    calib_delta: float   # δ̄ used for the secant fit  (provenance for §12.1)
    convex_flag: bool    # §2.3 — arc is non-concave; ratio-sweep required
    clamped: bool        # B forced to 0; a is a chord slope, cap is mandatory
    flag_reason: enum    # NONE | DIVIDED_DIFF | STRUCTURAL | CLAMPED | BOTH
    drift: float         # D₂/D₁ − 1, §12.2
    eta: float           # 3aD₃/(2D₂²), §12.2
    reverse: PoolArc     # the opposite direction — separately calibrated (§2.6)
    asym: float          # log(B_r/B_f) + 1.5·log(a_f/a_r); 0 ⟹ (M8) usable
    gamma_live: float    # √(a_f·a_r) — measured effective retention

Route:
    arcs: [(PoolArc, delta_in, expected_out)]
    paths: [[PoolArc]]           # flow decomposition, netted
    modelled_out: float
    verified_out: float | None
    certificate: bool            # §5.5 over all m pools AND no active flagged arc
    chord_active: bool           # §12.2b — a flagged arc carries flow
    relaxed_bound: float | None  # Σ H_i(μ) + μ D_G; gap to verified_out = sweep quality
    diagnostics: {max_theta, max_drift, max_eta_dev, total_loss_frac,
                  pivots, cg_rounds, pins_evaluated}

Solver:
    solve(pools, src, dst, X)      -> Route
    candidates(route, N)           -> [Route]        # §6, active-set diverse
    verify(candidates, block)      -> [Route]        # §7, multicall
    refit(route, quotes)           -> Route          # §8
```

Contract for callers: **`certificate = False` must be surfaced, not swallowed.** It means column generation was truncated, or a non-concave arc is carrying flow — the answer may still be good (and with `chord_active`, `relaxed_bound − verified_out` tells you *how* good), but it is not proven optimal. Downstream systems that size positions against router output need to know which.

---

## Appendix A — Derivations

**A.1 Loss decomposition (M5).**
With `ψ = ν̂_τ δ` and `f̂(δ) = aδ − ½Bδ²`:
```
loss = ψ − ν̂_σ f̂(δ) = ψ − ν̂_σ a δ + ½ ν̂_σ B δ²
     = ψ(1 − a ν̂_σ/ν̂_τ) + (ν̂_σ B / 2ν̂_τ²) ψ²
     = ε ψ + ψ²/(2G),        G = ν̂_τ²/(ν̂_σ B) = ν̂_τ a/B + O(ε)
```

**A.2 `G = TVL/4` for CPMM.**
`B = 2x₀/y₀²`, `a = x₀/y₀`, and balance implies `ν̂_σ x₀ = ν̂_τ y₀ = TVL/2`:
```
G = ν̂_τ a/B = ν̂_τ (x₀/y₀)(y₀²/2x₀) = ν̂_τ y₀ / 2 = TVL/4
```
Equivalently `R = 4/TVL`, and dissipated value is `½Rψ²` — literally `I²R/2`.

**A.3 Dual and Hessian.**
`(P)` has Lagrangian `Σ[εψ + ψ²/2G] − uᵀ(ŝ − Bᵀψ)`. Minimising over `ψ ≥ 0` gives (M6); substituting yields `(D)`. Then
```
∂D/∂u_t = ŝ_t + Σ_{σ=t} ψ_p − Σ_{τ=t} ψ_p        (KCL)
∂²D     = Σ_{p∈A} G_p (e_τ − e_σ)(e_τ − e_σ)ᵀ    (graph Laplacian)
```
`(D)` is `C¹` and piecewise quadratic; the Hessian jumps `0 → G_p` at each diode threshold. Pieces are smooth, so all nonsmoothness lives in the active-set combinatorics — which is exactly why finite pivoting works and no line search, trust region, or semismooth Jacobian selection is needed.

**A.4 Secant fit (M2).**
Matching `f̂(δ̄) = f(δ̄)` in `a δ̄ − ½B δ̄² = f(δ̄)` gives `B = 2(a δ̄ − f(δ̄))/δ̄²`. For CPMM this is `B = 2x₀/(y₀²(1+θ̄))`, and the resulting error ratio `(1+θ)(1+θ̄−θ)/(1+θ̄)` peaks at `θ = θ̄/2` with value `(1+θ̄/2)²/(1+θ̄) ≈ 1 + θ̄²/4`.

---

## Appendix B — Worked examples

**B.1 One pool.** `src → dst`, `a = A`, `B`. Single free node. `G = ν̂_src A/B`, `ε = 1 − A ν̂_dst/ν̂_src`. Solve: `ψ = Ψ`, `u_src = ε + Ψ/G`. Loss `= εΨ + Ψ²/2G`. Dual value equals primal loss exactly — the strong-duality smoke test.

**B.2 Two in parallel, `ε₁ = ε₂`.**
```
u_src = ε + Ψ/(G₁+G₂)
ψ_k   = G_k Ψ/(G₁+G₂)
```
Split **proportional to conductance**, hence to `TVL` for CPMM. Verify against brute-force scan of the split ratio.

**B.3 Two in parallel, `ε₂ > ε₁`.** Pool 2 stays at `ψ₂ = 0` until `u_src − u_dst > ε₂`, i.e. until `Ψ > G₁(ε₂ − ε₁)`. Below that threshold the certificate holds with `ρ₂ < 0`. This is the diode, and it is why optimal routes are sparse.

**B.4 Series with an arbitrage leg.** `src → mid → dst` where the second pool is dislocated so `ε₂ < 0`. The router activates the two-hop path in preference to a cheaper-looking direct pool, and KVL around the resulting cycle balances the negative EMF against the added fee plus impact. Good regression test for sign handling in §3.1.

---

## Appendix C — Design rationale, one line each

- **Value coordinates, not log-price.** Turns the element law linear and the Hessian into a plain (not gain-) Laplacian.
- **Dual, not primal.** `n` unknowns instead of `m`; gradient is KCL; Hessian is a Laplacian.
- **Column generation, not enumeration.** `O(m)` scalar test replaces exponential path search and yields a proof.
- **Secant, not tangent, calibration.** 4× accuracy for one extra probe.
- **Quadratic, not cubic.** `f'''` is not independent for CPMM, and it introduces a convex branch the optimizer will exploit.
- **Split arcs, not raise order.** Non-smooth features are the real problem, and higher derivatives are more contaminated by them, not less.
- **Calibrate directions separately.** `B` differs between directions by three powers of the price even on a plain CPMM, and on v3, stableswap and dynamic-fee pools the difference is structural, not coordinate. Value conductance is the one thing that *is* symmetric — third argument for value coordinates.
- **Probe as detector, not as model.** Extra probes correctly *see* dynamic-fee non-concavity, but no Taylor order that is faithful to increasing returns is admissible in a convex program. So the ladder sets a flag; the element law stays quadratic and `B_p` is clamped at zero, never negative.
- **Clamp to `B = 0`, with a chord and a cap.** Zero curvature is the admissible limit, not a fudge — an ideal diode with no series resistance. The chord makes it an upper bound instead of an under-estimate; the cap replaces the self-limiting term the clamp removed; the ceiling goes in `G`-space because `1/B` is where the conditioning dies.
- **Diverse active sets, not diverse ratios — unless an arc is flagged.** Ratio error is second order at a concave optimum; when a hull chord is active it is first order, and the active set may not move at all.
- **Pin-and-resolve, not hull construction.** Pinning reuses the saturated-arc path already in the solver and brackets a chord interior in microseconds; support functions and resultants stay off the hot path.
- **Verify on-chain.** Catches everything the model cannot represent — pauses, hooks, transfer taxes, stale state, and chord interiors.

---

## Appendix E — Measured implementation notes

Numbers taken on mainnet against the committed drpc key unless stated. They are
recorded because several are counter-intuitive and were each arrived at by
reversing an assumption that looked obviously right.

### E.1 Exact evaluation replaces probing where the pool proves it

A pool whose own parameters reproduce its own `get_dy` to the wei is computed
rather than probed (§11.3). Nothing is decided by pool type or by an address
list: every model is built, the pool is quoted for real, and the model is kept
only if it agrees at every check point in both directions. That rule is what
tells twocrypto's FX Swaps (stableswap invariant, cryptoswap machinery) from
cryptoswap proper without an address list that would rot.

    stableswap        261 / 266        vault directions   44 / 48
    twocrypto          84 /  92        LP pools            4 /  5
    tricrypto          13 /  13

The remainder are named rather than trusted: pools with a `POLICY` contract
whose fee varies with trade size, pools mid-A/gamma-ramp needing `newton_D`,
and stableswap-ng's dynamic per-coin LP fee.

**Vaults and LP arcs are the same idea at the two ends of the range.** At a
pinned block an ERC4626 vault is `out = in * S / A` — no curve, one ratio per
direction. Two things it is *not* safe to assume: the rounding convention
(OpenZeppelin carries a virtual offset `(S+1)/(A+1)`), and that the two
directions agree — three of ten mainnet vaults reproduce one direction and not
the other, because a vault can price a deposit cleanly and charge on the way
out. LP arcs run the same invariant with `D` moving (`solve_y_D`), where the
deployed source settles that `calc_token_amount` takes **no** fee while
`calc_withdraw_one_coin` charges on each coin's imbalance and returns one wei
less.

The payoff is not the arithmetic, which is ~2.5% of a quote. It is that a
candidate route is scored locally only when *every* leg is modelled, so one
un-modelled leg sends the whole route to the chain. On `crvUSD -> sDOLA`:

    before vaults   candidates walked  1, sent 16   probes computed 94%
    after vaults    candidates walked 10, sent  7
    after LP arcs   candidates walked 13, sent  0   probes computed 99%

### E.2 Cold start: ask the endpoint, do not assume a ceiling

The storage sweep was pinned to Erigon's default batch of 100 as "a ceiling
every node accepts". That is the slowest node's ceiling imposed on all of them;
drpc serves 2,000.

    batch     100     250     500    1000    2000
    ms/slot 18.96    2.32    1.80    0.94    0.69

    storage sweep  25,227 ms -> 3,250 ms (same 5,934 slots)
    cold start     23,380 ms -> 10,351 ms

The ceiling is now probed once, sequentially, with the request about to be sent
— a node may cap by method or payload size — before any concurrent chunk goes
out, which preserves the reason the constant existed: failing into a ceiling is
recoverable one chunk at a time and not sixteen at a time.

**What did not work, and why.** The state dumper (inject 27 bytes at a pool and
read its storage) cannot run on the scoped key at all: `eth_call` state
overrides return 403, and there is no deployable alternative because no contract
can read another account's storage. And *skipping* the sweep for pools that are
computed rather than executed is a net loss — those pools' getters are free
precisely because the slots are already loaded; reading the same parameters over
the wire cost 15.9 s against a 3.3 s sweep, since each batched `raw_batch` runs
600 real contract calls server-side while a storage batch is bare `SLOAD`s.

### E.3 Warm quotes are interpreter-bound, not arithmetic-bound

A warm quote makes **zero** transport round trips. Its ~800 ms is Python.

    active_set_solve (own)     45 calls   0.140 s
    component_of            2,250 calls   0.089 s
    numpy linalg.solve      2,242 calls   0.084 s
    calibrate               1,476 calls   0.066 s  (0.204 cumulative)
    numpy diff             11,886 calls   0.063 s
    split.evaluate          1,518 calls   0.051 s
    laplacian               2,242 calls   0.046 s
    ufunc.reduce           41,113 calls   0.041 s
    curves.at              43,046 calls   0.031 s
    stableswap d + solve_y  4,542 calls   0.034 s

The pool maths is 2.5% of it. The cost is call *volume*: hundreds of thousands
of operations each carrying ~1 us of interpreter overhead over nanoseconds of
work. A `$100` quote pays the same as a `$20M` one, because the work is a
function of the universe rather than of the trade.

Three optimisations, each measured and each answered:

* **Pure Python instead of numpy: 91x worse.** A dense LU at n=50 is 2,872 us
  in Python against 31.5 us through numpy. Dispatch is about half of that 31.5,
  but the C kernel is what makes the call affordable at all.
* **Rank-1 updates of the factorisation: no.** Measured at n=299 (6,304 us
  against 1,147 us to refactorise) and re-examined at the real per-pivot size,
  median n=49: a Python-level O(n^2) update costs hundreds of us to replace a
  51 us solve. Only compiled CHOLMOD wins, and scipy is barred from `core/` by
  the Pyodide constraint (§Portability).
* **Batching the Laplacians: 1.9x, but blocked where it matters.** Systems are
  independent *across* candidates and strictly sequential *within* a solve —
  pivot k+1's matrix depends on pivot k's `psi`. Lockstepping candidates would
  work and buys ~40 ms of ~800.

**What a native port would actually buy.** Counting the arithmetic rather than
the calls: 2,242 solves at n=50 is 187 Mflop (~37 ms at 5 GFLOP/s), Laplacian
assembly ~4.5 M updates, `component_of` ~6.8 M ops, the pool maths ~218 k u256
operations. Irreducible work is roughly **40-80 ms against a measured 800 ms**,
so ~90% is interpreter and dispatch that a port removes outright. The candidates
are the solver and `calibrate`: numerically self-contained, now stable, and
about half the quote between them.

Keeping it in Python while correctness is still moving has paid for itself: in
one session it surfaced a stranded-flow bug in `cancel_cycles` (§12.4 refusing a
route for damage done after the solve finished), a 20x cold-start batch ceiling,
and three changes that measurement rejected outright.

### E.3b The port, measured against that prediction

The estimate above was that ~90% of a warm quote is interpreter and dispatch,
leaving 40-80 ms of irreducible arithmetic. The solver is now ported (PyO3
extension plus an `rlib` for wasm, no I/O, no threads, no BLAS), and the
prediction held for the part that was ported: the solve went from 240 ms to
53 ms on a warm crvUSD->sDOLA at $100, and a warm quote from ~830 ms to ~235 ms.
Per pivot, 130 us to 23.8 us. Pivot counts, call counts and the integer output
are identical to the reference.

**§9.3's rank-1 claim is right in compiled code and wrong in Python, and E.3
above says so for the right reason.** The Python measurement that rejected it
(6,304 us against 1,147 us to refactorise) was measuring the interpreter, not
the algorithm. In Rust the same idea is what makes the port fast: refactorising
is `O(k^3/6)` and an update is `O(k^2)`, the kept-node set fixes the dimension,
and it was measured to change on 21% of pivots on real graphs. Two conditions
had to be added that the spec does not mention:

* **The factor must be dropped whenever the kept set changes**, not merely when
  its size does. A different set of the same cardinality silently reuses a
  factor of the wrong matrix -- measured KCL residuals of 5.6e+06.
* **A rank-1 chain drifts, and these Laplacians run to `cond(G) ~ 1e8`.**
  Measured 1.1e-5 where refactorising gave 6.7e-9. So each solve prices its own
  answer: the residual is computed off the arcs in `O(m)` and only a solve that
  has actually gone off pays for a rebuild. Residuals then match the reference's.

**The factor is stored transposed, and that is worth 4x on its own.** Of the
four hot loops over it, two walk `L` by column -- the back-substitution and the
update's sweep below the diagonal. Row-major `L` puts those strides `n` apart.
Holding `U = L^T` makes all four contiguous: factor 47.9 -> 8.1 us per pivot,
back-substitution 34.9 -> 3.3 us, whole pivot 94.9 -> 23.8 us. Same arithmetic,
same numbers; only the addresses moved. No section of the loop is now above 34%.

**Two bugs the differential tests could not see.** Both lived in the seam, not
the algorithm, and both were invisible to a unit test because a unit test
supplies its own arguments:

* `A0` may be *indices* -- `Solution.active` is exactly that, and it is what the
  pipeline warm-starts from -- and the bridge ran `np.asarray(a0, bool)` over
  it, mapping `[3, 17]` to two `True`s. Every accelerated solve began from a
  basis the reference never chose. Of 54 problems taken off a live quote, 8
  agreed on the pivot count; with the fix, 93 of 94.
* The resident-graph cache wrote through `object.__setattr__` onto a
  `slots=True` dataclass, so every write raised into a bare `except` and the
  cache measured **0 hits in 132 solves**. Packing 32 ms -> 0 ms.

The lesson is the one E.3 already implies: replay real problems, with the real
arguments, and compare against the reference. Shaped cases and fuzzed graphs
agreed to 1e-12 throughout all of the above.

**What is not ported, and why it is not obvious.** The accelerator stays
opt-in (`EROUTER_ACCEL=1`). At $1M and below the two agree to the wei, but at
$20M the reference itself converges cleanly on 9 of 86 subproblems -- 55 return
`PARTIAL`, 14 refuse a detached pin, two cycle under Bland's rule -- and once
there is no clean optimum to agree on, the two wander apart, landing 113 to
315 bp apart on USDC->WETH, USDC->WBTC and crvUSD->sDOLA. Those sizes sit at
`theta` in the hundreds of percent, outside the model's range, but "the answer
depends on which solver ran" is not a property to ship.

After the port the warm quote is no longer solver-bound: the solve is 4-31% of
it, and `calibrate` (37 ms over 738 arcs) and `spfa` (29 ms) are each now
comparable to it. `calibrate` is 49.8 us per call on a **six-element** ladder,
where a single `np.diff` pair is 5.0 us -- numpy is the wrong tool at that size,
and scalar arithmetic in either language removes it.

### E.4 Against Curve's own solver

Pinned to the block their snapshot reports and given their gas price, since
their answer comes from a periodically-warmed snapshot running blocks behind
head; rows split into stable and volatile because on a trending price that
staleness is worth 1.8-27.7 bp, always in their disfavour.

    16 comparable stable rows: 10 ahead, 7 level, 0 behind, median +0.69 bp
    6 of them match to the wei

The wins are two-leg splits where they take one leg: +17.21 bp (arbitrum
`USDC->crvUSD` 250k), +13.13 bp (gnosis `USDCe->WXDAI` 100k). Excluded from the
median: an arbitrum `USDC->USDT0` 500k row reading +1063 bp, which is a pair
with no depth at that size — their quote loses 37%, ours 30%, and neither is a
route anybody should take.

## Appendix D — Sources

The CryptoSwap-NG closed forms (§2.3), the apex localisation of the fee defect (§2.5), and the chord counterexample (§11.2) are taken from the *CryptoSwap-NG split math* lemma set — respectively its direct-pair derivatives, its pole-adapted boundary chart, and its execution-boundary result on hull relaxations. That work solves a different problem (certified integer-lattice optimum for one pair, exact invariant) and its Lagrangian support machinery is the same duality this document uses, specialised to parallel-only topology. The two compose: its certified partition is the offline form of this document's `CONVEX_FLAG`, and this document's graph layer is what it does not address.
