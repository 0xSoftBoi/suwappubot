"""The flow-conservation gate against the arithmetic it is judging (§12.4).

The gate asks whether the flow about to be executed conserves.  It used to ask
with a flat 1e-8, while `graph.py` deliberately admits conductance spreads up to
`MAX_CONDITION = 1e12` -- and a linear solve of condition number `k` carries
relative error about `k * eps`, which at that ceiling is 2e-4.  So the check
demanded four orders more accuracy than the graph it was checking could supply,
and rejected healthy routes whenever their active set happened to be stiff.

Measured on USDC->CRV $1M: residual 1.16e-07 against a 1.13e-08 tolerance, with
the active Laplacian at `k = 2.3e9` and `k * eps = 5.2e-07`.  The solve was
running four times better than its conditioning guaranteed, and was refused.
Whether a route landed above or below the line moved with BLAS thread count,
which is what made it look intermittent.

These tests hold the two ends together: the bound must track `k`, and it must
stay far below the failure the gate exists to catch.
"""

from __future__ import annotations

import numpy as np
import pytest

from erouter.core.graph import MAX_CONDITION, ArcArrays
from erouter.core.pipeline import EPS, KCL_CONDITION_SAFETY, _achievable_kcl


def arcs(tau, sig, G, n_nodes) -> ArcArrays:
    size = len(tau)
    return ArcArrays(
        tau=np.array(tau, dtype=np.int64),
        sig=np.array(sig, dtype=np.int64),
        G=np.array(G, dtype=float),
        a=np.ones(size),
        B=np.ones(size),
        eps=np.zeros(size),
        cap=np.full(size, np.inf),
        flagged=np.zeros(size, bool),
        clamped=np.zeros(size, bool),
        n_nodes=n_nodes,
    )


def test_a_well_conditioned_graph_earns_almost_no_slack():
    """Equal conductances: the bound must stay far below any real violation."""
    g = arcs([0, 1], [1, 2], [1.0, 1.0], 3)
    bound = _achievable_kcl(g, np.array([1.0, 1.0]), dst=2)
    assert bound > 0
    assert bound < 1e-10, "a benign graph must not be handed meaningful slack"


def test_the_bound_grows_with_the_conductance_spread():
    """A stiffer graph can afford less accuracy, and the gate should know."""
    mild = arcs([0, 1], [1, 2], [1.0, 10.0], 3)
    stiff = arcs([0, 1], [1, 2], [1.0, 1e9], 3)
    psi = np.array([1.0, 1.0])
    assert _achievable_kcl(stiff, psi, dst=2) > 100 * _achievable_kcl(mild, psi, dst=2)


def test_even_the_worst_permitted_conditioning_still_catches_conjured_flow():
    """The failure this gate exists for is `O(Psi)` -- a residual near 1.

    At the graph's own ceiling the bound is ~2e-2, so a conjured-flow failure
    is still two orders clear of it.  If `MAX_CONDITION` is ever raised, this
    is the test that should start complaining.
    """
    worst = KCL_CONDITION_SAFETY * MAX_CONDITION * EPS
    assert worst < 1e-1, "the bound has grown into the range it must detect"
    assert worst > 1e-4, "sanity: at 1e12 the achievable error really is large"


def test_no_flow_yields_no_slack():
    """Nothing to condition: the caller's flat tolerance stays in charge."""
    g = arcs([0, 1], [1, 2], [1.0, 1.0], 3)
    assert _achievable_kcl(g, np.zeros(2), dst=2) == 0.0


def test_flow_disconnected_from_dst_yields_no_slack():
    """An arc that cannot reach `dst` must not buy the route any tolerance --
    that is precisely the conjured-flow shape the gate is looking for."""
    g = arcs([0, 3], [1, 4], [1.0, 1.0], 5)
    assert _achievable_kcl(g, np.array([0.0, 1.0]), dst=1) == 0.0


@pytest.mark.parametrize("kappa", [1e4, 1e6, 1e9])
def test_the_bound_is_the_safety_factor_times_k_eps(kappa):
    """The bound is `SAFETY * k * eps` and nothing else -- no hidden fudge.

    Recomputed from the same Laplacian the router solves, so this pins the
    formula rather than restating it.
    """
    from erouter.core.graph import laplacian

    g = arcs([0, 1], [1, 2], [1.0, kappa], 3)
    bound = _achievable_kcl(g, np.array([1.0, 1.0]), dst=2)
    L = laplacian(g.tau, g.sig, g.G, 3, np.array([0, 1]))
    assert bound == pytest.approx(KCL_CONDITION_SAFETY * np.linalg.cond(L) * EPS,
                                  rel=1e-9)
