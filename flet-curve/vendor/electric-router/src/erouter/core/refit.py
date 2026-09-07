"""Refit at the realised size and re-solve (spec §8, §7 rule 3).

The first solve calibrates every arc at a *guessed* size -- `d_bar` is
bootstrapped from TVL before anything is known about the split.  Once the
optimum says how much each arc actually carries, two more quotes per active arc
re-anchor the model there:

    quote f(delta_p) and f(1.01 delta_p)
    B_p <- 2 (a_p delta_p - f(delta_p)) / delta_p^2       (M2, at the real size)
    recompute G, eps ; re-solve warm-started
    stop when max|d psi| / Psi < 1e-4

`a` deliberately stays the tangent from the probe grid: it is what `eps` is
built from, it is stable, and re-deriving it from a large trade would fold
price impact into what is supposed to be the zero-size marginal rate.  The
extra `1.01 delta` quote is what §7 rule 3 buys -- the *realised* slope, which
gives `f''` at the true operating point and, more importantly, catches an arc
whose returns are increasing right where the route wants to use it.

Converges in two rounds essentially always, because `B_p` varies slowly with
`delta_p` -- it is a fixed point in a quantity that is nearly constant.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from .graph import ArcArrays, arc_params, ceiling_conductance
from .quoter import QuoterClient
from .types import PoolArc, Probe

SLOPE_STEP = 0.01  # §7 rule 3's 1.01 * delta
CONVERGED = 1e-4  # §8's stopping rule on max|d psi| / Psi
#: How much of `a * delta` the secant's numerator must be before it is a
#: measurement rather than rounding.
#
# `B = 2(a d - f(d)) / d^2` differences two numbers that agree to within a few
# basis points, then divides by `d^2`.  `a` is a *fitted* tangent, so the
# numerator carries an error of order `sigma_a * d` and the error in `B` falls
# only as `1/d`.  Below some size the numerator is entirely that error --
# including its sign, which is how a refit at a realised delta of 3 USDC replaced
# a fit made at a million, got `B < 0`, and clamped the best pool for the pair to
# a cap of 3 USDC.
#
# `a` is good to something like 1e-7 relative; this asks an order of magnitude of
# headroom on top.  Failing the test is not an error: it means this probe knows
# less than the ladder fit already in hand, so the ladder's fit stands.
SECANT_REL_FLOOR = 1e-6
#: How far below the size an arc was last calibrated at the refit may re-anchor.
#
# The floor above catches a numerator lost in `a`'s own error.  It does not
# catch the other end of the same problem: at dust sizes the *pool's* integer
# arithmetic stops being meaningful, and then the numerator is large in
# relative terms while being nonsense.  Measured on crvUSD/USDT at block
# 25,769,383 -- a $45M pool, ladder-fitted `B = 4.4e-11` at a delta of 3.9M --
# a realised delta of 0.4 USDT quoted an output well below `a * delta`, and the
# secant read `B = 1.73`, an implied depth of about half a dollar.
#
# §8 exists to re-anchor a guessed size onto the realised one.  Three orders
# below the existing fit is not re-anchoring, it is extrapolating outside the
# measured range with an error term that has grown a thousandfold; the fit
# already on the arc is strictly better evidence.  Checked before the probes
# are planned, so it costs nothing rather than an RPC round trip.
REFIT_MIN_FRACTION = 1e-3


@dataclass(slots=True)
class RefitRound:
    quoted: int = 0
    reflagged: int = 0
    #: Arcs whose realised size was too small for the secant to resolve their
    #: curvature; they keep the ladder's fit.  See `SECANT_REL_FLOOR`.
    unresolved: int = 0
    max_delta_psi: float = float("inf")
    max_b_change: float = 0.0
    converged: bool = False


@dataclass(slots=True)
class RefitReport:
    rounds: list[RefitRound] = field(default_factory=list)
    psi: np.ndarray | None = None
    changed: bool = False
    note: str = ""

    @property
    def converged(self) -> bool:
        return bool(self.rounds and self.rounds[-1].converged)


def _probe_pair(arc: PoolArc, delta_raw: int) -> list[Probe]:
    bumped = int(delta_raw * (1 + SLOPE_STEP))
    return [
        Probe(arc.pool, arc.kind, arc.i, arc.j, arc.n_coins, delta_raw),
        Probe(arc.pool, arc.kind, arc.i, arc.j, arc.n_coins, max(bumped, delta_raw + 1)),
    ]


def refit_arcs(
    g: ArcArrays,
    arcs: list[PoolArc],
    psi: np.ndarray,
    nu: np.ndarray,
    client: QuoterClient,
    *,
    rate_in,
    rate_out,
) -> tuple[int, int, int]:
    """Re-anchor `B` for every arc carrying flow.

    Returns `(quoted, reflagged, unresolved)`.

    `rate_in`/`rate_out` map an arc to its node-merge scaling, so the fit is
    done in the same canonical units the solver works in.
    """
    active = np.flatnonzero(psi > 0)
    if active.size == 0:
        return 0, 0, 0

    probes: list[Probe] = []
    plan: list[tuple[int, int, float]] = []  # (arc index, probe offset, delta canonical)
    unresolved = 0
    for k in active:
        arc = arcs[int(k)]
        delta_canonical = float(psi[k]) / float(nu[arc.tau])
        delta_token = delta_canonical / rate_in(arc)
        delta_raw = int(delta_token * 10**arc.decimals_in)
        if delta_raw <= 0:
            continue
        if (arc.calib_delta > 0
                and delta_canonical < REFIT_MIN_FRACTION * arc.calib_delta):
            # Outside the range this arc was measured over -- see
            # `REFIT_MIN_FRACTION`.  Keep the fit it already has, and do not
            # spend the two probes finding that out.
            unresolved += 1
            continue
        plan.append((int(k), len(probes), delta_canonical))
        probes.extend(_probe_pair(arc, delta_raw))

    if not probes:
        return 0, 0, unresolved
    answers = client.probe(probes)

    quoted = 0
    reflagged = 0
    for index, offset, delta_canonical in plan:
        arc = arcs[index]
        at_delta, at_bumped = answers[offset], answers[offset + 1]
        if not at_delta.ok or at_delta.value <= 0:
            continue

        scale_out = 10**arc.decimals_out
        f_delta = at_delta.value / scale_out * rate_out(arc)
        # (M2) at the realised size: match the true curve at 0 and at delta.
        signal = arc.a * delta_canonical - f_delta
        if abs(signal) <= SECANT_REL_FLOOR * arc.a * delta_canonical:
            # Below what this secant can resolve -- see `SECANT_REL_FLOOR`.
            # The ladder fit already on the arc was made at a size where the
            # curvature was measurable, so leave it alone rather than replacing
            # a measurement with its own rounding error.
            unresolved += 1
            continue
        B = 2.0 * signal / delta_canonical**2
        quoted += 1

        if at_bumped.ok and at_bumped.value > at_delta.value:
            f_bumped = at_bumped.value / scale_out * rate_out(arc)
            slope = (f_bumped - f_delta) / (delta_canonical * SLOPE_STEP)
            # The marginal rate must fall with size.  If it rises here, the arc
            # has increasing returns exactly where the route wants to use it --
            # inadmissible in a convex program, so clamp and flag (§11.2).
            #
            # Compared against the same floor: `a` is fitted, so a slope above
            # it by less than `a`'s own accuracy is not increasing returns.  A
            # 1e-9 tolerance here was two orders tighter than `a` is true, and
            # every arc that tripped it was clamped on the strength of it.
            if slope > arc.a * (1 + SECANT_REL_FLOOR):
                B = 0.0
                if not arc.convex_flag:
                    reflagged += 1
                arc.convex_flag = True

        if B <= 0.0:
            # The zero-curvature limit, with the mandatory cap (§2.3 rule 2).
            arc.B = 0.0
            arc.clamped = True
            arc.convex_flag = True
            arc.cap = min(arc.cap, delta_canonical)
        else:
            arc.B = B
            arc.clamped = False
        arc.calib_delta = delta_canonical
    return quoted, reflagged, unresolved


def rebuild(g: ArcArrays, arcs: list[PoolArc], nu: np.ndarray) -> ArcArrays:
    """Recompute G and eps in place after a refit, keeping the same indexing."""
    a = np.array([arc.a for arc in arcs])
    B = np.array([arc.B for arc in arcs])
    G, eps = arc_params(g.tau, g.sig, a, B, nu)
    flagged = np.array([arc.convex_flag for arc in arcs])
    g.a, g.B = a, B
    g.G = ceiling_conductance(G, flagged) / g.g_scale
    g.eps = eps
    g.flagged = flagged
    g.clamped = np.array([arc.clamped for arc in arcs])
    caps = []
    for arc in arcs:
        if np.isfinite(arc.cap):
            caps.append(float(nu[arc.tau] * arc.cap) / g.g_scale)
        else:
            caps.append(np.inf)
    g.cap = np.array(caps)
    return g


def refit(
    g: ArcArrays,
    arcs: list[PoolArc],
    psi: np.ndarray,
    nu: np.ndarray,
    client: QuoterClient,
    solve_fn,
    Psi: float,
    *,
    rate_in,
    rate_out,
    rounds: int = 2,
) -> RefitReport:
    """§8's loop.  `solve_fn(g, A0) -> Solution` re-solves the updated graph."""
    report = RefitReport()
    current = np.array(psi, dtype=float)

    for _ in range(rounds):
        entry = RefitRound()
        before = np.array([arc.B for arc in arcs])
        entry.quoted, entry.reflagged, entry.unresolved = refit_arcs(
            g, arcs, current, nu, client, rate_in=rate_in, rate_out=rate_out
        )
        if entry.quoted == 0:
            report.note = (
                f"no arc could be re-quoted at its realised size"
                f"{f' ({entry.unresolved} below the secant floor)' if entry.unresolved else ''}"
            )
            report.rounds.append(entry)
            break

        after = np.array([arc.B for arc in arcs])
        moved = np.abs(after - before) / np.maximum(np.abs(before), 1e-30)
        entry.max_b_change = float(moved.max()) if moved.size else 0.0

        rebuild(g, arcs, nu)
        solution = solve_fn(g, np.flatnonzero(current > 0))
        if not solution.feasible:
            report.note = f"refit made the problem infeasible: {solution.reason}"
            report.rounds.append(entry)
            break

        entry.max_delta_psi = (
            float(np.max(np.abs(solution.psi - current)) / Psi) if Psi > 0 else 0.0
        )
        entry.converged = entry.max_delta_psi < CONVERGED
        report.rounds.append(entry)

        current = solution.psi
        report.psi = current
        report.changed = True
        if entry.converged:
            break

    return report
