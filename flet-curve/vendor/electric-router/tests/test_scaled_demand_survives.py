"""The normalisation must not divide the demand into the solver's noise.

§9.1 normalises `G` by its median because (P) is homogeneous in `(G, Psi)`.
Any positive `s` leaves the problem the same problem, so the choice is free --
and it was being made without looking at what it does to `Psi`.  `solve` snaps
any `|psi|` under `TOL` (1e-9) to zero, in *scaled* units, so a large median
against a small trade annihilates the flow and returns a solution that is
"feasible" and carries nothing.  What reaches the caller is `RoutingError: the
optimal flow is empty`, which says nothing about the cause.

Measured on gnosis at block 47,871,103, XDAI -> EURe: a median `G` of 7.55e7
against `Psi = 6.83e-3` scaled the demand to 9.0e-11, and nineteen sizes
between 0.0080 and 0.0120 XDAI failed while their neighbours quoted normally.
Not a size floor -- a scattered set, because whether a later recalibration
happened to land on a rescuing median was the whole difference.

Uniform scaling cannot change the Laplacian's condition number, so nothing is
lost by capping the median: dividing every `G` by one number divides every
eigenvalue by it.  What the scaling buys is magnitude against fixed tolerances,
which is exactly what the demand needs too.
"""

from __future__ import annotations

import numpy as np

from erouter.core import graph
from erouter.core.solve import TOL


def _arrays(conductances):
    """A src -> mid -> dst chain, at whatever `G` the caller wants."""
    n = len(conductances)
    tau = np.array([0, 1, 0][:n], dtype=np.int64)
    sig = np.array([1, 2, 2][:n], dtype=np.int64)
    a = np.ones(n)
    # `build` derives G from a/B, so go straight at the array it produces.
    g = graph.build(tau, sig, a, np.full(n, 1e-3), np.ones(n), 1.0,
                    n_nodes=3, merge_duplicates=False, require=(0, 2))
    g.G = np.asarray(conductances, dtype=float)
    return g


def test_a_large_median_against_a_small_trade_keeps_the_demand():
    """The gnosis numbers: 7.55e7 median, 6.83e-3 of demand."""
    scaled, psi = graph.scale(_arrays([7.5e7, 7.6e7, 7.7e7]), 6.826e-3)
    assert psi >= graph.MIN_SCALED_PSI
    assert psi > TOL * 100, f"{psi} is inside the solver's rounding"


def test_the_median_still_wins_when_it_is_safe():
    """The floor must bind only where it has to, or every working quote moves
    onto a different scale than the one it was measured on."""
    g = _arrays([1.0e3, 1.0e3, 1.0e3])
    scaled, psi = graph.scale(g, 6.826e-3)
    assert scaled.g_scale == 1.0e3, "an untroubled median was overridden"
    assert psi == 6.826e-3 / 1.0e3


def test_the_flow_is_recoverable_at_the_floor():
    """`psi` comes back through `g_scale`, so the true demand is unchanged
    whichever way the scale was chosen."""
    for conductances in ([7.5e7] * 3, [1.0e3] * 3, [1e-4] * 3):
        g = _arrays(conductances)
        scaled, psi = graph.scale(g, 6.826e-3)
        assert np.isclose(psi * scaled.g_scale, 6.826e-3, rtol=1e-12)


def test_a_zero_demand_is_left_alone():
    """Nothing to protect, and dividing by it would be worse."""
    scaled, psi = graph.scale(_arrays([7.5e7] * 3), 0.0)
    assert scaled.g_scale == 7.5e7 and psi == 0.0
