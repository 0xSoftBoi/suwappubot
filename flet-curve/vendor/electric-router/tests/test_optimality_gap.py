"""What a solve left on the table, as opposed to how it stopped (§5.5).

The certificate used to be void whenever the pivoting bailed out -- cycling,
screened, partial -- regardless of where it landed.  But a point nothing wants
to improve on *is* optimal however it was reached, and a point that something
does want to improve on is worth reporting with a number rather than a label.

`optimality_gap` is that number: an arc held at zero with reduced cost `rho`
would settle at `psi = G rho` and take `G rho^2 / 2` off the objective, so
summing over the arcs that want in bounds the remaining improvement from above.
"""

from __future__ import annotations

import numpy as np
import pytest

from erouter.core.graph import ArcArrays
from erouter.core.solve import TOL, Solution, optimality_gap


def arcs(tau, sig, G, eps, n_nodes) -> ArcArrays:
    size = len(tau)
    return ArcArrays(
        tau=np.array(tau, dtype=np.int64),
        sig=np.array(sig, dtype=np.int64),
        G=np.array(G, dtype=float),
        a=np.ones(size),
        B=np.ones(size),
        eps=np.array(eps, dtype=float),
        cap=np.full(size, np.inf),
        flagged=np.zeros(size, bool),
        clamped=np.zeros(size, bool),
        n_nodes=n_nodes,
    )


def solution(psi, rho, n_nodes) -> Solution:
    size = len(psi)
    return Solution(
        psi=np.array(psi, dtype=float),
        u=np.zeros(n_nodes),
        A=np.array(psi, dtype=float) > 0,
        U=np.zeros(size, bool),
        psi_upper=np.zeros(size),
        rho=np.array(rho, dtype=float),
    )


def test_nothing_wants_in_is_a_gap_of_zero():
    """The case the check exists for: stopped early, but already optimal."""
    g = arcs([0, 1], [1, 2], [10.0, 10.0], [0.0, 0.0], 3)
    sol = solution([1.0, 1.0], [0.1, 0.1], 3)
    assert optimality_gap(sol, g, np.ones(2, bool), dst_node=2) == 0.0


def test_an_arc_that_wants_in_is_worth_g_rho_squared_over_two():
    g = arcs([0, 1, 0], [1, 2, 2], [10.0, 10.0, 4.0], [0.0, 0.0, 0.0], 3)
    sol = solution([1.0, 1.0, 0.0], [0.1, 0.1, 0.5], 3)
    assert optimality_gap(sol, g, np.ones(3, bool), dst_node=2) == pytest.approx(
        0.5 * 4.0 * 0.5 ** 2
    )


def test_noise_level_reduced_costs_do_not_make_a_gap():
    """The arcs that keep USDC->CRV cycling price at rho = 5.6e-17.

    Counting those would manufacture a gap out of arithmetic and deny a
    certificate the answer has earned.
    """
    g = arcs([0, 1, 0], [1, 2, 2], [10.0, 10.0, 3.3e7], [0.0, 0.0, 0.0], 3)
    sol = solution([1.0, 1.0, 0.0], [0.1, 0.1, 5.55e-17], 3)
    assert optimality_gap(sol, g, np.ones(3, bool), dst_node=2) == 0.0
    assert 5.55e-17 < TOL, "the threshold must sit above arithmetic noise"


def test_an_arc_the_trade_cannot_reach_is_not_an_opportunity():
    """§9.4 leaves `u = 0` outside `dst`'s component, so a favourable `eps`
    there reads as `rho > 0` -- flow no route could carry.  Counting it put the
    bound five orders above the objective itself."""
    g = arcs([0, 3], [1, 4], [10.0, 1e6], [0.0, -0.5], 5)
    sol = solution([1.0, 0.0], [0.1, 0.5], 5)
    assert optimality_gap(sol, g, np.ones(2, bool), dst_node=1) == 0.0


def test_an_unavailable_arc_is_not_counted():
    """Banned or out-of-`S` arcs are column generation's business, not this."""
    g = arcs([0, 1, 0], [1, 2, 2], [10.0, 10.0, 4.0], [0.0, 0.0, 0.0], 3)
    sol = solution([1.0, 1.0, 0.0], [0.1, 0.1, 0.5], 3)
    available = np.array([True, True, False])
    assert optimality_gap(sol, g, available, dst_node=2) == 0.0


def test_no_flow_at_all_yields_no_gap():
    g = arcs([0, 1], [1, 2], [10.0, 10.0], [0.0, 0.0], 3)
    sol = solution([0.0, 0.0], [0.5, 0.5], 3)
    assert optimality_gap(sol, g, np.ones(2, bool), dst_node=2) == 0.0
