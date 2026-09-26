"""Spec §13.1 analytic tests.  No chain, no pools -- arcs are given directly.

Priority order matters here.  The diode, the clamp bound and the conditioning
tests are the ones that fail *silently* under a plausible-looking wrong
implementation, so they are the ones worth reading first.
"""

from __future__ import annotations

import numpy as np
import pytest

from erouter.core import graph
from erouter.core.solve import TOL, active_set_solve, price_out, solve


def make(tau, sig, a, B, *, nu=None, cap=None, flagged=None, Psi=1.0, n=None, merge=True):
    tau = np.asarray(tau, np.int64)
    sig = np.asarray(sig, np.int64)
    n = n or int(max(tau.max(), sig.max()) + 1)
    nu = np.ones(n) if nu is None else np.asarray(nu, float)
    return graph.build(
        tau, sig, np.asarray(a, float), np.asarray(B, float), nu, Psi,
        cap=cap, flagged=flagged, n_nodes=n, merge_duplicates=merge,
    )


def kcl_residual(g, sol, src, dst, Psi):
    net = np.zeros(g.n_nodes)
    np.add.at(net, g.tau, sol.psi)
    np.subtract.at(net, g.sig, sol.psi)
    want = np.zeros(g.n_nodes)
    want[src] += Psi
    want[dst] -= Psi
    return np.max(np.abs(net - want)) / Psi


# ------------------------------------------------------------ single pool


def test_single_pool_strong_duality():
    """psi = X, and the dual value equals the primal loss exactly."""
    g = make([0], [1], [1.0], [1.0])
    X = 0.25
    sol = active_set_solve(g, 0, 1, X)

    assert sol.feasible
    assert sol.psi[0] == pytest.approx(X)
    assert sol.u[1] == 0.0  # grounded
    assert sol.u[0] == pytest.approx(g.eps[0] + X / g.G[0])

    primal = sol.objective(g)
    assert primal == pytest.approx(g.eps[0] * X + X**2 / (2 * g.G[0]))
    dual = X * (sol.u[0] - sol.u[1]) - 0.5 * g.G[0] * max(sol.u[0] - sol.u[1] - g.eps[0], 0) ** 2
    assert dual == pytest.approx(primal, abs=1e-12)


# --------------------------------------------------------------- parallel


def test_two_parallel_split_proportional_to_conductance():
    """Equal `a`: the split is exactly proportional to G, hence to 1/B."""
    g = make([0, 0], [1, 1], [1.0, 1.0], [1.0, 2.0])
    X = 1.0
    sol = active_set_solve(g, 0, 1, X)

    total = g.G.sum()
    assert sol.psi[0] == pytest.approx(g.G[0] * X / total)
    assert sol.psi[1] == pytest.approx(g.G[1] * X / total)
    assert sol.psi[0] / sol.psi[1] == pytest.approx(2.0)  # B 1 vs 2
    assert kcl_residual(g, sol, 0, 1, X) < 1e-12


def test_split_beats_any_single_pool():
    g = make([0, 0], [1, 1], [1.0, 1.0], [1.0, 2.0])
    X = 1.0
    both = active_set_solve(g, 0, 1, X).objective(g)
    for only in (0, 1):
        banned = np.ones(g.m, bool)
        banned[only] = False
        alone = active_set_solve(g, 0, 1, X, forbidden=banned)
        assert both < alone.objective(g)  # less loss is better


# ----------------------------------------------------------------- series


def test_two_in_series_potentials_are_kirchhoff():
    """u at the intermediate node is the marginal rate of the second hop."""
    g = make([0, 1], [1, 2], [1.0, 1.0], [1.0, 1.0])
    X = 0.5
    sol = active_set_solve(g, 0, 2, X)

    assert sol.psi == pytest.approx([X, X])  # value is conserved along the path
    assert sol.u[2] == 0.0
    assert sol.u[1] == pytest.approx(X / g.G[1] + g.eps[1])
    assert sol.u[0] == pytest.approx(sol.u[1] + X / g.G[0] + g.eps[0])
    assert kcl_residual(g, sol, 0, 2, X) < 1e-12


# ------------------------------------------------------------------ diode


def test_diode_threshold_is_exact():
    """The property most likely to be silently broken by a refactor.

    Two parallel arcs with identical G and eps2 = eps1 + 1e-4.  Below
    Psi = G1 (eps2 - eps1) the second arc must carry *exactly* zero, not a tiny
    positive amount; above it, it must switch on.  This zero is what makes real
    routes sparse.
    """
    delta = 1e-4
    a = [1.0, 1.0 - delta]
    B = [1.0, 1.0 - delta]  # so G = a/B = 1 for both
    g = make([0, 0], [1, 1], a, B, Psi=1e-3)
    assert g.G[0] == pytest.approx(g.G[1])
    assert g.eps[1] - g.eps[0] == pytest.approx(delta)

    threshold = g.G[0] * delta

    below = active_set_solve(g, 0, 1, threshold * 0.5)
    assert below.psi[1] == 0.0  # exactly, not approximately
    assert below.psi[0] == pytest.approx(threshold * 0.5)
    assert below.rho[1] < TOL  # reverse-biased: complementary slackness holds

    above = active_set_solve(g, 0, 1, threshold * 10)
    assert above.psi[1] > 0.0
    assert above.psi[0] > above.psi[1]  # the cheaper arc still carries more


def test_complementarity_holds_everywhere():
    """§12.4's complementarity invariant, on the right quantity.

    `rho` is the voltage across the arc, so an active arc has rho = psi/G > 0
    -- the element law, not a violation.  What must vanish is the Lagrangian
    gradient on arcs that are free to move.
    """
    g = make([0, 0, 0], [1, 1, 1], [1.0, 0.999, 0.99], [1.0, 1.0, 1.0], Psi=1e-3)
    sol = active_set_solve(g, 0, 1, 1e-3)

    assert np.all(sol.psi >= 0)
    assert np.max(np.abs(sol.psi * sol.reduced(g))) < 1e-12

    on = sol.psi > 0
    assert sol.rho[on] == pytest.approx(sol.psi[on] / g.G[on])  # (M6)
    assert np.all(sol.rho[~on] <= TOL)  # off-arcs are reverse-biased


# ---------------------------------------------------------------- battery


def test_battery_routes_through_a_dislocated_pool():
    """An eps < 0 arc is an EMF, and must be used even off the direct path.

    Direct 0->2 is mildly lossy; 0->1->2 costs an extra hop but the second leg
    is favourably dislocated.  KVL around the resulting cycle balances the
    negative EMF against the added fee plus impact.
    """
    # eps = 1 - a (nu == 1), so a > 1 gives a negative drop.
    g = make(
        [0, 0, 1],
        [2, 1, 2],
        [0.999, 1.0, 1.02],  # direct 10bp; hop1 free; hop2 pays 200bp
        [1.0, 1.0, 1.0],
        Psi=1e-3,
    )
    assert g.eps[2] < 0
    sol = active_set_solve(g, 0, 2, 1e-3)
    assert sol.psi[1] > 0 and sol.psi[2] > 0  # the two-hop battery path is used
    assert sol.psi[1] == pytest.approx(sol.psi[2])
    assert sol.objective(g) < 0  # the arbitrage more than pays for the trip


# ------------------------------------------------------------ capacities


def test_capacity_saturates_and_spills_over():
    g = make([0, 0], [1, 1], [1.0, 0.999], [1.0, 1.0], cap=[0.1, np.inf], Psi=1.0)
    sol = active_set_solve(g, 0, 1, 1.0)
    assert sol.psi[0] == pytest.approx(0.1)  # pinned at its cap
    assert sol.psi[1] == pytest.approx(0.9)
    assert sol.rho[0] >= -TOL  # saturated arc is forward-biased


def test_pinning_reuses_the_capacity_path():
    """§6.3's sweep must be a keyword argument, not a new code path."""
    g = make([0, 0], [1, 1], [1.0, 1.0], [1.0, 2.0], Psi=1.0)
    free = active_set_solve(g, 0, 1, 1.0)
    pinned = active_set_solve(g, 0, 1, 1.0, forced_upper={0: 0.25})
    assert pinned.feasible
    assert pinned.psi[0] == pytest.approx(0.25)
    assert pinned.psi[1] == pytest.approx(0.75)
    # the free optimum must be at least as good as any pinned restriction
    assert free.objective(g) <= pinned.objective(g) + 1e-15


# --------------------------------------------------------- certificate


def test_certificate_when_nothing_outside_S_wants_flow():
    g = make([0, 0, 1], [1, 2, 2], [1.0, 0.99, 1.0], [1.0, 1.0, 1.0], Psi=1.0)
    report = solve(g, 0, 2, 1.0)
    assert report.solution.feasible
    assert report.certificate
    assert price_out(report.solution.u, g, np.ones(g.m, bool)).size == 0


def test_column_generation_recovers_an_arc_left_out_of_the_seed():
    """Seed quality must affect only the round count, never the answer."""
    g = make([0, 0], [1, 1], [1.0, 1.0], [1.0, 2.0], Psi=1.0)
    seed = np.array([True, False])
    partial = solve(g, 0, 1, 1.0, seed=seed)
    full = solve(g, 0, 1, 1.0)
    assert partial.certificate and full.certificate
    assert partial.solution.psi == pytest.approx(full.solution.psi)
    assert partial.cg_rounds >= 2  # it had to be priced in


def test_certificate_is_false_when_a_flagged_arc_carries_flow():
    """§5.5 proves nothing about a non-concave arc, so say so."""
    g = make([0], [1], [1.0], [1.0], flagged=[True], Psi=1.0)
    report = solve(g, 0, 1, 1.0)
    assert report.solution.psi[0] > 0
    assert not report.certificate
    assert report.reason == "CHORD_ACTIVE"


# ------------------------------------------------------ graph invariants


def test_clamped_arc_without_a_cap_fails_at_precompute():
    """Not defensive: a B=0 arc has no self-limiting term, so a negative-eps
    cycle would give unbounded flow.  Fail loudly here, not later."""
    with pytest.raises(ValueError, match="finite cap"):
        make([0], [1], [1.0], [0.0])


def test_negative_curvature_is_rejected_rather_than_inverted():
    """B < 0 would give G < 0 -- a negative resistor and an indefinite
    Laplacian.  calibrate() must clamp it; the graph refuses to guess."""
    with pytest.raises(ValueError, match="negative curvature"):
        make([0], [1], [1.0], [-1.0])


def test_conductance_ceiling_keeps_the_condition_number_bounded():
    """The clamp must happen in G-space.  Flooring B at 1e-30 instead gives
    G ~ 1e30 and ruins the factorisation for every other arc -- an assertion
    rather than a code-review item because the route still looks plausible."""
    g = make(
        [0, 0], [1, 1], [1.0, 1.0], [1.0, 0.0],
        cap=[np.inf, 5.0], flagged=[False, True], Psi=1.0,
    )
    assert np.isfinite(g.G).all()
    assert g.condition() < graph.MAX_CONDITION
    assert g.G[1] == pytest.approx(graph.CEILING_FACTOR * g.G[0])

    floored = np.array([1.0, 1e-30])
    with pytest.raises(ValueError, match="max\\(G\\)/min\\(G\\)"):
        make([0, 0], [1, 1], [1.0, 1.0], floored, Psi=1.0)


def test_duplicate_arcs_merge_as_parallel_resistors():
    g = make([0, 0], [1, 1], [1.0, 1.0], [1.0, 1.0], Psi=1.0)
    assert g.m == 1
    assert g.G[0] == pytest.approx(2.0)  # 1/R = 1/R1 + 1/R2
    assert g.sources[0] == [0, 1]


def test_dust_arcs_are_dropped():
    g = make([0, 0], [1, 1], [1.0, 1e-12], [1.0, 1.0], Psi=1.0, merge=False)
    assert g.m == 1
    assert g.dropped == {1: "DUST"}


# -------------------------------------------------------- connectivity


def test_disconnected_source_is_reported_not_crashed():
    """Legitimate during drop-an-arc candidate generation: skip, don't crash."""
    g = make([0, 2], [1, 3], [1.0, 1.0], [1.0, 1.0], n=4, Psi=1.0)
    sol = active_set_solve(g, 0, 3, 1.0)
    assert not sol.feasible
    assert "not connected" in sol.reason


def test_leaf_orphaned_by_a_pivot_does_not_produce_a_singular_factor():
    """§14's listing deletes only `dst`; the first pivot that orphans a leaf
    then gives a singular Laplacian.  Recomputing the component fixes it."""
    # Node 2 hangs off node 1 by an arc that will never carry flow.
    g = make(
        [0, 1, 0],
        [1, 2, 1],
        [1.0, 0.5, 1.0],
        [1.0, 1.0, 2.0],
        n=3,
        Psi=1.0,
        merge=False,
    )
    sol = active_set_solve(g, 0, 1, 1.0)
    assert sol.feasible
    assert sol.psi[1] == 0.0
    assert kcl_residual(g, sol, 0, 1, 1.0) < 1e-12


# ------------------------------------------------------------- monotonicity


@pytest.mark.parametrize("X", [1e-6, 1e-3, 1.0, 10.0])
def test_output_is_monotone_and_concave_in_size(X):
    g = make([0, 0, 1], [1, 2, 2], [1.0, 0.999, 1.0], [1.0, 2.0, 1.5], Psi=X)
    lo = active_set_solve(g, 0, 2, X)
    hi = active_set_solve(g, 0, 2, 2 * X)
    assert lo.feasible and hi.feasible
    # more value routed, more absolute loss, but never a lower marginal rate
    assert hi.objective(g) >= lo.objective(g) - 1e-15
    assert kcl_residual(g, lo, 0, 2, X) < 1e-10


# ------------------------------------------------------- the KCL gate itself


def test_kcl_tolerance_does_not_tighten_without_limit_as_the_trade_shrinks():
    """§12.4's gate must not reject small trades for being small.

    The solve runs in units scaled by `g_scale`, so its roundoff is absolute
    there and is multiplied by `g_scale` on the way out.  Expressed purely as a
    fraction of `Psi`, the gate therefore tightens without limit as `Psi` falls:
    on mainnet USDC->USDT, `g_scale = 1.5e6` turned a clean 1e-11 solve into a
    4.7e-5 relative residual at $1 -- identical routing, and every trade under a
    few hundred dollars rejected with "flow conservation is violated".
    """
    from erouter.core.pipeline import _kcl_tolerance

    g_scale = 1.5e6
    # The measured residuals, which are all floating-point noise.
    assert _kcl_tolerance(1.0, g_scale) > 4.7e-5
    assert _kcl_tolerance(10.0, g_scale) > 1.8e-6
    assert _kcl_tolerance(100.0, g_scale) > 2.9e-9

    # ...and it must still catch the failure it exists for.  Flow conjured on
    # arcs outside the active component is O(Psi), i.e. a relative residual of
    # order 1, which no scale may excuse.
    for Psi in (1.0, 1e3, 1e6):
        assert _kcl_tolerance(Psi, g_scale) < 1.0

    # Large trades keep a tight absolute bound rather than inheriting a loose
    # one: g_scale is a property of the graph, not of the trade.
    assert _kcl_tolerance(1e5, g_scale) < 1e-7


def test_a_stale_warm_start_cannot_decide_feasibility():
    """A previous size's support must not make a larger size unroutable.

    An interactive session prepares once and quotes many sizes through the same
    `Prepared`, carrying each solve's support into the next as `A0`.  Reproduced
    on mainnet crvUSD -> sDOLA: $100 routes on a single arc, and $2,000,000
    through that same `Prepared` then failed with "src not connected to dst
    through the active set".  The arc caps out at the larger size, moves to the
    upper-bounded set, and leaves the active set with nothing joining src to dst;
    column generation cannot rescue it, since it widens the column set, which was
    never the restriction.

    Here: a cheap arc capped well below the trade, and a dearer uncapped one.
    Warm-started from the cheap arc alone, the solve has to reach the other.
    """
    tau, sig = [0, 0], [1, 1]
    g = make(tau, sig, a=[1.0, 0.98], B=[1e-6, 1e-6],
             cap=np.array([0.05, np.inf]), Psi=1.0)

    cold = solve(g, 0, 1, 1.0)
    warm = solve(g, 0, 1, 1.0, A0=np.array([0], dtype=np.int64))

    assert cold.solution.feasible
    assert warm.solution.feasible, warm.reason
    assert warm.solution.psi.sum() == pytest.approx(cold.solution.psi.sum(), rel=1e-9)
    assert warm.solution.objective(g) == pytest.approx(cold.solution.objective(g), rel=1e-6)
