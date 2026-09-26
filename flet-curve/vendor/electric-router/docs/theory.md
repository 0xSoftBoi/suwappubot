# The circuit model, and what actually runs

Two halves. The first is the idea the router is built on and the argument for
why a crude model is the right one. The second is what the implementation
actually does, which has moved a long way from the design in places — each
divergence here is one a measurement forced.

[`quadratic-flow-router.md`](quadratic-flow-router.md) is the design spec and
stays the reference for derivations and for the `§` numbers the code cites.
This document is what to read first, and what to trust where the two disagree.
[`browser-port.md`](browser-port.md) is what it takes to run this in Flet, and
[`router.md`](router.md) what it takes to settle a route on chain.

---

## 1. The idea

Route `X` of `src` into as much `dst` as possible across `m ≈ 10³` pools over
`n ≈ 10²` tokens, splitting in parallel and chaining in series.

Model each pool by its first two derivatives, hold `f''` constant, and measure
flow in **value** rather than token units. The routing problem then becomes,
exactly, a **linear resistor network with diodes**:

| circuit | routing |
|---|---|
| conductance `G_p` | pool depth |
| forward drop `ε_p` | fee + price dislocation |
| current `ψ_p` | value routed through the pool |
| node potential `u_t` | token's shadow price |
| diode | one-way: a swap cannot be run backwards for profit |

Kirchhoff's current law at every token node *is* the flow-conservation
constraint. The optimum is a **sparse SPD graph-Laplacian solve** inside a
finite active-set loop, and column generation prices out all `m` arcs to give a
**certificate of global optimality** while touching a few dozen.

Two consequences worth stating plainly, because they are what the whole design
buys:

**No path enumeration.** `(P)` is an edge-flow program: the constraint is
`Bᵀψ = ŝ` at every node, not "decompose into paths". Flow splits at any
intermediate node and merges at any node with no special case, and a pool
entered by two different paths sees the *net* flow — path-based routers
double-count impact exactly there. Paths are a presentation artefact, derived
after the fact.

**Branching is the generic case.** The element law `ψ_p = G_p(u_τ − u_σ − ε_p)₊`
fills every outgoing arc whose potential drop exceeds its own `ε`, the way
current divides at a node. A single-path route is the special case.

## 2. Why the model is allowed to be crude

The quadratic is wrong by `O(θ²)` where `θ = δ/reserve`. That does not matter
for the two things it decides, because **both are first-order-flat at the
optimum**: which pools are selected, and how flow splits between them. Perturb
the split at the optimum and the objective moves second-order.

So the model is used for **combinatorics** and the chain is used for
**arithmetic**. Every number the router publishes has been quoted on-chain at
the pinned block; the model only chose what to quote.

This is also why the model must be *conservative*. §2.3's zero-curvature clamp
turns a pool with negative curvature into the admissible limit — a linear arc
with a chord rate and a mandatory finite cap — which is an upper bound, and an
upper bound cannot prune the true optimum. A more faithful Taylor fit with
`f'' > 0` is not merely inaccurate, it is **inadmissible**: it makes the
Laplacian indefinite.

Where the argument stops holding is size. Past roughly a tenth of a pool's
reserve the quadratic understates the real loss, and past its own reserve it is
meaningless. §5 covers what the implementation does about that.

## 3. What actually runs

```
universe        Curve API (or Lite) → min-TVL floor → blacklist
                → reserve check → arcs withheld by data/facts
warm            local EVM primed from a committed slot cache
exact models    stableswap · twocrypto · tricrypto · vault · LP,
                each gated wei-exact against its own get_dy
node merges     native wrap · wstETH · allowlisted ERC4626 · duals
                · transmuters · stake and lending arcs
probe grid      geometric ladder → calibrate (a, B, cap, flags)
prices          weighted least squares on log-prices (§4)
solve           seed → active set → price out all m → certificate
size check      recalibrate by secant where θ > 3% (§12.1)
candidates      C₀ · drops · pins · scout · split optimiser
verify          every candidate quoted on-chain at the pinned block
refit           at the realised size, re-solve
legs            the winner's legs re-quoted one by one at their final
                sizes, which is what a per-leg bound has to be set against
```

Gas and revert risk are priced into candidate selection, not bolted on
afterwards: a leg costs what it costs to execute, and a route's own minimum-out
has a probability of tripping before it lands.

### The part the spec did not have: exact models

The largest change. Where a pool's own parameters reproduce its own `get_dy`
**to the wei**, the router computes `f(δ)` instead of fitting it — exact at any
size, where the quadratic is worst exactly at the sizes that matter.

The safety argument is the gate, not the arithmetic. A misread `A`, a rate array
in the wrong order or the wrong fee convention produces a curve that is
confidently wrong at every size and, unlike a failed probe, does not announce
itself. So every candidate model is quoted for real and kept only if it agrees
to the wei at six points — three sizes spanning three decades, both directions.
A pool that does not reproduce keeps being probed.

Mainnet, at the time of writing: **269 of 270 stableswap, 85 of 93 twocrypto,
15 of 15 tricrypto** are computed rather than probed. Verdicts are cached
against a fingerprint over the source of every module that participates, so
editing an invariant discards every verdict on every chain.

### Node merges

In value coordinates a linear element is a short circuit — `ε = 0`, `G = ∞` —
which is the same node. That covers native ETH/WETH, wstETH/stETH, allowlisted
ERC4626 vaults, and **duals**: two addresses that are one market but not one
balance, which no read distinguishes and which are therefore declared.

Merging is gated on an allowlist and never on discovery. Linearity of
`convertToAssets` is necessary and nowhere near sufficient: pufETH is perfectly
linear and redeems through a withdrawal queue, sUSDe has a seven-day cooldown.
Merging either would mint the market's discount from nothing. A vault that fails
degrades to a capped one-way arc, which is honest and still routable.

## 4. Where practice left the spec

Each of these overturned a design decision, and each was a measurement.

**Dense LU, refactorising every pivot** — not sparse Cholesky with rank-1
updates. At `n ≈ 300` dense LU is 15–25% *faster* than dense Cholesky and 3×
faster than `splu`, whose per-call symbolic analysis dominates; a pure-numpy
rank-1 update is 5.5× slower than simply refactorising. The textbook advice is
right at `n ≈ 10⁵` and wrong here. This also removed scipy from the solver,
leaving numpy as the core's only third-party dependency.

**A local EVM, not round trips.** The whole universe's storage is swept once
into an in-process EVM; a `get_dy` then costs 30–449 µs against ~0.8 ms on the
wire. The sweep is not redundant with the parameter reads that follow — it is
what makes them free.

**Multi-port elements: built, measured, removed.** A pool with `N > 2` coins can
serve several ports in one interaction, and pricing the pair together is the
arithmetic that matches execution. A pinned-block A/B over nine pairs returned
**byte-identical output in all nine**, and of ten element candidates generated,
zero produced a quote. Kept in [`multi-port-elements.md`](multi-port-elements.md) so the idea is not
rebuilt from the same reasoning.

**Scout weight is route conductance.** A candidate route is scored by the
effective conductance of the circuit it forms, resistors `1/TVL` in series and
merges as shorts. It favours branching and depth for the same reason a circuit
does, without going through whatever split the model happened to give it.

**The θ ceiling became a warning.** Re-probing an arc past the pool's own
reserve does not measure it — the quotes come back saturated and the refit reads
that as a wall — so the size check clamps its ladder to the reserve and only
warns past 10%. The model still understates there, and the candidate set is what
protects the answer.

**Pool-level removal is human-decided.** Measured surveys find candidates
(`find_broken_pools.py`, `find_reverting_arcs.py`) and a person puts them in the
chain's blacklist with what was measured written beside it. Two pools across 17
chains fail the "no solvable `D`" test; base carries 610 junk pools below the
TVL floor and one above it.

**The Rust solver is opt-in.** `EROUTER_ACCEL=1`. It reproduces the Python
active set to 1e-12 on shaped and fuzzed problems and matches OSQP on all of
them, and a warm mainnet quote drops from ~600 ms to ~170 ms. It is not the
default because of §5.

## 5. What is still wrong

Stated because a router that hides these is worse than one that does not.

**The model understates loss past ~10% of reserve.** `ETH → ETHx` at 241% of
the pool's reserve modelled 24.8 bp against 970.8 verified. The §12.1
escalation says so on the route, the quote itself is the chain's own number, and
where alternatives exist the candidate set catches it — across 13 routes with
θ > 10%, a drop/top-N/refit/`C*` candidate won nine times. It is contained, not
solved.

**The two solvers disagree where the solve does not converge.** `USDC → WETH
$20M` returns 7,166 WETH through Python and 7,185 through Rust at the same
block; at $5M they are identical. Those quotes reach `maxit`, cycle under
Bland's rule and return `PARTIAL`. The lesson recorded at the time is about the
tests rather than the port: a differential over problems that converge in a
handful of pivots cannot cover a solver whose interesting behaviour is what it
does when it fails to.

**The TVL floor costs small trades.** Replaying executed Router trades on base,
the one row we lose is a 50-cent swap the caller routed through a $3,552 pool —
below our $10,000 floor. The floor that keeps 610 junk pools out is the same
floor that hides that one. A size-aware floor is the principled fix and has not
been built.

**A view-only quote cannot see a rug.** Nothing in a `staticcall` distinguishes
a pool that will honour its quote from one that will move on broadcast. The
defences are structural — the blacklist, the reserve check, the invariant check,
the executed-arc facts — and none of them is a proof.

## 6. Invariants

Asserted rather than hoped for. `G_p > 0` is made structurally impossible to
violate: `calibrate()` is the only function that produces a `B`, the
zero-curvature clamp lives inside it, so `B ≥ 0` is a postcondition and
`clamped ⟹ cap < ∞` is a class invariant. The §12.4 checks — flow conservation
to `k·eps`, duality gap, conditioning ceiling, one arc per pool per route —
remain as tripwires.

`certificate` is non-optional and pairs with a reason (`CG_TRUNCATED`,
`CHORD_ACTIVE`, `DEGENERATE`, `PARTIAL`, `RESTRICTED`, `NO_SOLUTION`) whenever
false.  `RESTRICTED` reads worse than it is — the winning candidate was a
restriction of the full program, so the gap bounds the *relaxation* and not the
executed route.
`--strict` exits non-zero on it. A certificate that is false and swallowed is
the failure mode the whole diagnostic layer exists to prevent.
