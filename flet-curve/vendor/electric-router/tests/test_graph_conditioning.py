"""The pathological-conditioning guard, and what it is actually for.

It exists to catch a `B` floored where a `G` should have been ceilinged --
a 1e-30 floor becoming a 1e30 conductance, which is a bug in the calibration
rather than a property of the market.  That failure puts a spike at the *top*
of the conductance range.

The bottom is a different animal.  A dust pool sitting almost entirely on one
side genuinely quotes a huge rate, so its `a` is correct and its `G` is
minuscule -- and the dust floor is about to drop it regardless.  Measuring the
spread before the floor let such a pool kill the whole quote:

    Curve.fi oBTC/sbtcCRV, holding 0.0105 oBTC against 1.39 crvRenWSBTC
    a probe of 0.0000105 oBTC returns 9.55x -- chain and local EVM agree
    G = 4.1e-16 against a floor of 1e-4, so the arc was dropped anyway
    max(G)/min(G) = 5.694e+26  ->  ValueError, and no route at all
"""

from __future__ import annotations

import numpy as np
import pytest

from erouter.core import graph


def _arcs(a, B, n=3):
    """A src -> mid -> dst chain plus one extra arc, as (tau, sig)."""
    tau = np.array([0, 1, 0], dtype=np.int64)
    sig = np.array([1, 2, 2], dtype=np.int64)
    return tau, sig, np.asarray(a, float), np.asarray(B, float), np.ones(n)


def test_a_dust_arc_does_not_kill_the_quote():
    """Its `G` is below the floor, so it is dropped -- not an assertion."""
    # Third arc: a real 9.55x quote off a near-empty pool.  1e-16 against a
    # floor of 1e-6 * Psi.
    tau, sig, a, B, nu = _arcs([1.0, 1.0, 9.55], [1e-3, 1e-3, 1.5e3])
    g = graph.build(tau, sig, a, B, nu, 100.0, n_nodes=3, merge_duplicates=False,
                    require=(0, 2))
    assert g.m >= 2, "the healthy arcs must survive"


def test_a_clamped_arc_in_the_wrong_space_is_still_caught():
    """The failure the guard is for: a floored `B` becoming a vast `G`.

    This one sits at the *top* of the range and above the dust floor, so
    filtering the bottom must not hide it.
    """
    tau, sig, a, B, nu = _arcs([1.0, 1.0, 1.0], [1e-3, 1e-3, 1e-30])
    with pytest.raises(ValueError, match="clamped in the wrong space"):
        graph.build(tau, sig, a, B, nu, 100.0, n_nodes=3, merge_duplicates=False,
                    require=(0, 2))


def test_an_ordinary_spread_is_untouched():
    """The widest genuine spread measured on Ethereum is ~4e10."""
    tau, sig, a, B, nu = _arcs([1.0, 1.0, 1.0], [1e-3, 1e-3, 4e-13])
    g = graph.build(tau, sig, a, B, nu, 100.0, n_nodes=3, merge_duplicates=False,
                    require=(0, 2))
    assert g.m == 3, "nothing here should be dropped"
