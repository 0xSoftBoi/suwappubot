"""Cancelling a circulation must not disturb anything else in the flow.

`cancel_cycles` removes loops the model thinks are free money, because a router
cannot execute a circulation as part of a one-way trade.  Subtracting the minimum
around a directed cycle leaves conservation exactly intact, which is what makes
the operation safe.

The cleanup afterwards was not restricted to the cycle:

    flow[flow <= tol] = 0.0

`<= tol` catches every *negative* entry in the whole vector, and a negative `psi`
is flow in the reverse direction, not dust -- an active-set solve that stops early
(`reason='PARTIAL'`) legitimately leaves them.  Zeroing one strands its magnitude
at both endpoints.

Measured on USDC->WBTC 1M at block 25,780,887: the solve delivered conservation
to 3.202e-10 with three negative arcs, the largest -0.130407.  After this function
the residual was 8.404e-03, and §12.4 refused the route for damage done after the
solve had finished.  The guard was right; the flow handed to it was not.
"""

from __future__ import annotations

import numpy as np

from erouter.core.realize import cancel_cycles

# `tau` is an arc's origin, `sig` its head.
#   0: 0->1   the trade
#   1: 1->2   the trade
#   2: 1->3 \ a circulation, which is what this function exists to remove
#   3: 3->1 /
#   4: 4->5   somebody else's flow, negative, nowhere near the cycle
TAU = np.array([0, 1, 1, 3, 4])
SIG = np.array([1, 2, 3, 1, 5])
PSI = np.array([1.0, 1.0, 0.5, 0.5, -0.3])
N = 6


def imbalance(tau, sig, psi):
    net = np.zeros(N)
    np.add.at(net, tau, psi)
    np.subtract.at(net, sig, psi)
    return net


def test_the_circulation_is_removed():
    flow, removed = cancel_cycles(TAU, SIG, PSI.copy())
    assert removed == 1
    assert flow[2] == 0.0 and flow[3] == 0.0
    assert flow[0] == 1.0 and flow[1] == 1.0


def test_a_negative_arc_elsewhere_is_left_alone():
    """The regression: `flow <= tol` is not `this cycle settled`."""
    flow, _ = cancel_cycles(TAU, SIG, PSI.copy())
    assert flow[4] == -0.3, (
        "an arc carrying reverse flow was zeroed by the cycle cleanup; its "
        "magnitude is now stranded at both of its endpoints"
    )


def test_conservation_is_untouched():
    """A circulation carries no net delivery, so nothing may move."""
    before = imbalance(TAU, SIG, PSI)
    flow, _ = cancel_cycles(TAU, SIG, PSI.copy())
    after = imbalance(TAU, SIG, flow)
    assert np.allclose(before, after, atol=1e-12), (
        f"cancelling a cycle moved the node balances by "
        f"{np.max(np.abs(after - before)):.3e}"
    )


def test_dust_inside_the_cycle_still_settles_to_zero():
    """The cleanup is still needed -- subtraction leaves a residue."""
    psi = PSI.copy()
    psi[2] = 0.5 + 1e-15
    flow, removed = cancel_cycles(TAU, SIG, psi)
    assert removed == 1
    assert flow[2] == 0.0 and flow[3] == 0.0
