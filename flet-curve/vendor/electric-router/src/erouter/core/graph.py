"""Value-coordinate graph assembly (spec §3.1, §9.5-9.7).

Working in *value* rather than token units is what makes the dual Hessian a
plain graph Laplacian instead of a gain-graph one, and it is also why arc
conductance is direction-symmetric while `a` and `B` are wildly asymmetric.

Everything is struct-of-arrays: the solver never sees a Python object.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

# §9.6 an arc that cannot carry meaningful flow only adds pivots
DUST_FLOOR = 1e-6
# §9.7 clamped (B=0) arcs would otherwise carry G = inf
CEILING_FACTOR = 1e3
MAX_CONDITION = 1e12
# What the adaptive dust floor aims at, with headroom below MAX_CONDITION.
TARGET_CONDITION = 1e11
# Beyond this, the spread is not a wide universe -- it is a bug.
PATHOLOGICAL_CONDITION = 1e15


def arc_params(
    tau: np.ndarray,
    sig: np.ndarray,
    a: np.ndarray,
    B: np.ndarray,
    nu: np.ndarray,
) -> tuple[np.ndarray, np.ndarray]:
    """(M3) conductance and (M4) forward drop, in value coordinates.

        G_p = nu_tau * a_p / B_p        value scale x token-space conductance
        eps_p = 1 - a_p * nu_sig / nu_tau

    For a constant-product pool G collapses to TVL/4 -- the elementary
    "resistance of a pool is 4/TVL" result.

    `eps` may be negative: that is a favourably dislocated pool, an EMF, and it is
    exactly how arbitrage enters the routing problem.

    B == 0 is the admissible zero-curvature limit (§2.3), giving G = inf here;
    `ceiling_conductance` bounds it afterwards.  B < 0 is *not* admissible and
    must have been clamped at calibration -- it is rejected loudly rather than
    turned into a negative resistor.
    """
    if np.any(B < 0):
        bad = int(np.argmin(B))
        raise ValueError(
            f"negative curvature reached the graph (arc {bad}, B={B[bad]:.3e}). "
            "calibrate() must clamp B to 0; a negative G makes the Laplacian "
            "indefinite and voids the certificate (§11.2)."
        )
    with np.errstate(divide="ignore", invalid="ignore"):
        G = np.where(B > 0, nu[tau] * a / np.where(B > 0, B, 1.0), np.inf)
    eps = 1.0 - a * nu[sig] / nu[tau]
    return G, eps


def ceiling_conductance(
    G: np.ndarray,
    flagged: np.ndarray,
    factor: float = CEILING_FACTOR,
) -> np.ndarray:
    """§2.3 rule (3) / §9.7 -- clamp in G-space, never by flooring B.

    A 1e-30 floor on B becomes a 1e30 conductance and destroys the condition
    number of the whole Laplacian, which is worse than the defect it patches.

    Only clamped arcs (`G = inf`) are affected: every finite arc is by definition
    at or below the maximum.  Do **not** lower this ceiling to bound the condition
    number -- flattening real conductances makes every deep pool look identical,
    and the solver then splits arbitrarily among them instead of by depth.  Bound
    the spread from below instead (see `dust_floor` in `build`).
    """
    finite = np.isfinite(G) & ~flagged
    reference = G[finite].max() if finite.any() else 1.0
    return np.minimum(np.where(np.isfinite(G), G, np.inf), factor * reference)


@dataclass(slots=True)
class ArcArrays:
    """Solver input.  Index space is post-dust, post-duplicate-merge."""

    tau: np.ndarray
    sig: np.ndarray
    a: np.ndarray
    B: np.ndarray
    G: np.ndarray
    eps: np.ndarray
    cap: np.ndarray
    flagged: np.ndarray
    clamped: np.ndarray
    n_nodes: int
    g_scale: float = 1.0
    # Set when the dust floor had to be backed off for connectivity and the
    # resulting spread exceeds MAX_CONDITION.  Non-fatal, but worth surfacing.
    ill_conditioned: float = 0.0
    # index -> original arc indices (a merged duplicate group has several)
    sources: list[list[int]] = field(default_factory=list)
    dropped: dict[int, str] = field(default_factory=dict)
    # Somewhere for an accelerator to keep a resident copy of this graph across
    # the ~90 solves one quote runs over it.  `slots=True` means there is
    # otherwise nowhere to put it, and the attempt fails silently.  Not part of
    # the value -- excluded from `__eq__` and `repr`.
    accel: object | None = field(default=None, repr=False, compare=False)

    @property
    def m(self) -> int:
        return len(self.tau)

    def condition(self) -> float:
        positive = self.G[self.G > 0]
        return float(positive.max() / positive.min()) if positive.size else 1.0


def build(
    tau: np.ndarray,
    sig: np.ndarray,
    a: np.ndarray,
    B: np.ndarray,
    nu: np.ndarray,
    Psi: float,
    *,
    cap: np.ndarray | None = None,
    flagged: np.ndarray | None = None,
    clamped: np.ndarray | None = None,
    n_nodes: int | None = None,
    dust_floor: float = DUST_FLOOR,
    ceiling_factor: float = CEILING_FACTOR,
    merge_duplicates: bool = True,
    require: tuple[int, int] | None = None,
) -> ArcArrays:
    """Assemble solver arrays, in the order §9.5-9.7 requires.

    Dust first (so the ceiling reference is meaningful), then duplicate merge,
    then the conductance ceiling, then the invariants.
    """
    tau = np.asarray(tau, dtype=np.int64)
    sig = np.asarray(sig, dtype=np.int64)
    a = np.asarray(a, dtype=float)
    B = np.asarray(B, dtype=float)
    m = len(tau)
    n = int(n_nodes if n_nodes is not None else max(tau.max(), sig.max()) + 1)

    cap = np.full(m, np.inf) if cap is None else np.asarray(cap, dtype=float)
    flagged = np.zeros(m, bool) if flagged is None else np.asarray(flagged, bool)
    clamped = (B == 0.0) if clamped is None else np.asarray(clamped, bool)

    # §12.4: a zero-curvature arc has no self-limiting term, so without a finite
    # cap a negative-eps cycle gives unbounded flow.  Fail here, not in the solve.
    unbounded = clamped & ~np.isfinite(cap)
    if unbounded.any():
        raise ValueError(
            f"clamped arcs {list(np.flatnonzero(unbounded))} have no finite cap; "
            "flow would be unbounded (§2.3 rule 2)"
        )

    G, eps = arc_params(tau, sig, a, B, nu)

    sources = [[k] for k in range(m)]
    dropped: dict[int, str] = {}

    # --- §9.6 dust ------------------------------------------------------
    #
    # §9.6's floor is `1e-6 * Psi`.  On a real universe that is not enough on its
    # own: genuine conductances span 4e10 on Ethereum -- a $45k pool against a
    # deep stableswap near its peg -- so `max/min` can breach §12.4's 1e12 bound
    # without anything being wrong.
    #
    # Raise the floor rather than lower the ceiling.  An arc with
    # `G = 1e-4 * Psi` carrying even a 0.1% share would lose ~0.5% to impact, so
    # it can never be part of a sensible route.
    base_floor = dust_floor * Psi
    floor = base_floor
    finite_G = G[np.isfinite(G)]
    positive_G = finite_G[finite_G > 0]
    # Measured over the arcs that will survive the floor, not over every arc.
    #
    # What this catches is a `B` floored instead of a `G` ceilinged, which puts a
    # spike at the *top*.  The bottom is a different animal: a dust pool almost
    # entirely on one side genuinely quotes a huge rate, and `a` is then correct
    # rather than broken -- measured on `oBTC/sbtcCRV`, where a tiny probe really
    # does return 9.55x and the chain agrees to the wei.  Such an arc is about to
    # be dropped by the floor anyway, but the spread was computed first and the
    # whole quote died on an assertion about a pool no route could have used.
    usable_G = positive_G[positive_G >= base_floor]
    if usable_G.size > 1:
        raw_spread = float(usable_G.max() / usable_G.min())
        if raw_spread > PATHOLOGICAL_CONDITION:
            # No real universe looks like this: the widest genuine spread
            # measured on Ethereum is ~4e10.  A spread of 1e15+ means B was
            # floored instead of G being ceilinged.  Say so, rather than letting
            # the adaptive dust floor "fix" it by dropping every other arc.
            raise ValueError(
                f"max(G)/min(G) = {raw_spread:.3e} before flooring; "
                "something is being clamped in the wrong space (§9.7)"
            )
    if finite_G.size:
        # Aim at the spread that will exist *after* the ceiling runs: a clamped
        # arc is lifted to `ceiling_factor * max`, so budgeting against the
        # pre-ceiling maximum alone leaves the assertion tripping on real data.
        top = float(finite_G.max())
        if (~np.isfinite(G)).any():
            top *= ceiling_factor
        floor = max(floor, top / TARGET_CONDITION)

    # Conditioning must never cost connectivity: back the floor off until the
    # nodes we have to route between are still joined.  A badly conditioned
    # solve is recoverable; a graph with no path is not.
    dust = G < floor
    backed_off = False
    if require is not None:
        while floor > base_floor:
            alive = ~dust
            reachable = component_of(require[1], tau[alive], sig[alive], n)
            if reachable[require[0]]:
                break
            floor /= 10.0
            backed_off = True
            dust = G < max(floor, base_floor)
    keep = ~dust
    for k in np.flatnonzero(dust):
        dropped[int(k)] = "DUST"

    # --- §9.5 duplicates, as parallel resistors -------------------------
    if merge_duplicates:
        groups: dict[tuple, int] = {}
        order: list[int] = []
        for k in np.flatnonzero(keep):
            key = (
                int(tau[k]),
                int(sig[k]),
                round(float(a[k]), 12),
                round(float(B[k]), 12),
            )
            if key in groups:
                head = groups[key]
                G[head] += G[k]
                cap[head] = cap[head] + cap[k]
                sources[head].append(int(k))
                keep[k] = False
                dropped[int(k)] = "MERGED"
            else:
                groups[key] = int(k)
                order.append(int(k))

    idx = np.flatnonzero(keep)
    arrays = ArcArrays(
        tau=tau[idx],
        sig=sig[idx],
        a=a[idx],
        B=B[idx],
        G=G[idx],
        eps=eps[idx],
        cap=cap[idx],
        flagged=flagged[idx],
        clamped=clamped[idx],
        n_nodes=n,
        sources=[sources[k] for k in idx],
        dropped=dropped,
    )

    # --- §9.7 ceiling, after the dust floor -----------------------------
    arrays.G = ceiling_conductance(arrays.G, arrays.flagged, ceiling_factor)

    # --- §12.4 invariants -----------------------------------------------
    if arrays.m and not np.all(arrays.G > 0):
        bad = int(np.argmin(arrays.G))
        raise ValueError(f"arc {bad} has G={arrays.G[bad]:.3e}; Laplacian would not be PSD")
    condition = arrays.condition()
    if condition >= MAX_CONDITION:
        if not backed_off:
            raise ValueError(
                f"max(G)/min(G) = {condition:.3e} >= {MAX_CONDITION:.0e}; "
                "something is being clamped in the wrong space (§9.7)"
            )
        # The dust floor was lowered above precisely to keep `src` joined to
        # `dst`, and that is the whole reason the spread is this wide.  Failing
        # here would contradict the rule that produced the state: a badly
        # conditioned solve is recoverable and the §12.4 KCL residual check
        # adjudicates it, whereas a graph with no path is simply no route.
        arrays.ill_conditioned = condition
    return arrays


#: The smallest the scaled demand may become.  `solve` snaps any `|psi|` under
#: its `TOL` of 1e-9 to zero, and it does that in **scaled** units -- so a
#: normalisation that divides the demand below that annihilates the whole flow
#: and returns a "feasible" solution carrying nothing.  Measured on gnosis at
#: block 47,871,103: a $0.008 XDAI -> EURe quote against a median `G` of 7.6e7
#: scaled to 9.0e-11, and nineteen sizes between 0.0080 and 0.0120 failed with
#: "the optimal flow is empty" while their neighbours quoted normally.
#:
#: 1e-6 is a thousand times `TOL`, and the smallest scaled demand measured to
#: solve correctly on that pair -- so the floor binds only where the median
#: would otherwise have gone too far, and leaves every quote that works today
#: on exactly the scale it has now.
MIN_SCALED_PSI = 1e-6


def scale(arrays: ArcArrays, Psi: float) -> tuple[ArcArrays, float]:
    """§9.1 -- (P) is homogeneous in (G, Psi), so normalise G by its median.

    `u`, `eps` and `rho` are dimensionless and unchanged; only psi rescales.
    Without this, G spans 10+ orders (dust pool vs 100M pool) and the numbers
    the solver compares against its fixed tolerances sit nowhere near 1.

    Which is the whole point, and the reason the demand gets a say: uniform
    scaling cannot change the Laplacian's condition number -- dividing every
    `G` by one number divides every eigenvalue by it -- so what this buys is
    magnitude, not conditioning, and a normalisation that puts `G` near 1 by
    putting `Psi` under `TOL` has bought nothing and lost the route.  Any
    positive `s` leaves the problem the same problem, so where the two pull
    apart the demand wins.
    """
    positive = arrays.G[arrays.G > 0]
    s = float(np.median(positive)) if positive.size else 1.0
    if not np.isfinite(s) or s <= 0:
        s = 1.0
    if Psi > 0.0 and np.isfinite(Psi):
        s = min(s, Psi / MIN_SCALED_PSI)
    arrays.G = arrays.G / s
    arrays.cap = arrays.cap / s
    arrays.g_scale = s
    return arrays, Psi / s


# ------------------------------------------------------------ topology


def laplacian(
    tau: np.ndarray, sig: np.ndarray, G: np.ndarray, n: int, keep: np.ndarray
) -> np.ndarray:
    """L = B^T diag(G) B restricted to `keep`, assembled in O(nnz).

    Built directly on the *kept* index space rather than as an n x n matrix that
    is then sliced.  The active set is usually a handful of nodes out of ~300, so
    allocating the full matrix every pivot dominated the solve -- measured at ~10x
    the cost of the factorisation itself.

    An arc with exactly one endpoint kept still contributes its diagonal term:
    that is what grounds the system at `dst`.
    """
    size = len(keep)
    position = np.full(n, -1, dtype=np.int64)
    position[keep] = np.arange(size)

    head = position[tau]
    tail = position[sig]
    matrix = np.zeros((size, size))

    live_head = head >= 0
    np.add.at(matrix, (head[live_head], head[live_head]), G[live_head])
    live_tail = tail >= 0
    np.add.at(matrix, (tail[live_tail], tail[live_tail]), G[live_tail])
    both = live_head & live_tail
    np.add.at(matrix, (head[both], tail[both]), -G[both])
    np.add.at(matrix, (tail[both], head[both]), -G[both])
    return matrix


def component_of(root: int, tau: np.ndarray, sig: np.ndarray, n: int) -> np.ndarray:
    """Nodes reachable from `root` over the given (undirected) arcs.

    §9.4: `L_A > 0` iff every free node connects to `dst` through the active
    set.  §14's reference listing deletes only `dst`, which produces a singular
    factorisation the first time a pivot orphans a leaf -- so this is recomputed
    every pivot rather than once.
    """
    seen = np.zeros(n, bool)
    if n == 0:
        return seen
    seen[root] = True
    if len(tau) == 0:
        return seen
    # Iterate to a fixed point; the arc count is small and this is branch-free.
    # Both directions in one sweep, over an arc list doubled once up front, rather
    # than two half-sweeps per iteration: at this size the cost is numpy's
    # per-call dispatch, not the work.  Called 679 times in a route, once per
    # pivot per §9.4.
    src = np.concatenate((tau, sig))
    dst = np.concatenate((sig, tau))
    for _ in range(n):
        reach = seen[src] & ~seen[dst]
        if not reach.any():
            break
        seen[dst[reach]] = True
    return seen
