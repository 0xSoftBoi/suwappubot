"""§8's refit must not manufacture curvature out of its own rounding.

`B = 2(a d - f(d)) / d^2` differences two numbers that agree to a few basis
points and divides by `d^2`.  `a` is a fitted tangent, so at small `d` the
numerator *is* `a`'s error -- sign included -- and a negative `B` takes the
zero-curvature branch, clamping the arc to a cap of `d`.

Measured on mainnet USDC -> crvUSD at $5M: the crvUSD/USDC pool's realised delta
was 3 USDC against a `calib_delta` of 1,000,000, `B` came out -7.2e-08 against a
true 5e-10, and the best pool for the pair was left admissible for three dollars.
"""

from __future__ import annotations

import numpy as np
import pytest

from erouter.core.quoter import Quote
from erouter.core.refit import SECANT_REL_FLOOR, refit_arcs
from erouter.core.transport import Status
from erouter.core.types import ArcKind, PoolArc

#: The true curve, close to the mainnet arc this test is drawn from.
TRUE_A = 1.0008496402
TRUE_B = 5.0e-10
DECIMALS = 18


class Chain:
    """`f(x) = a x - B/2 x^2`, rounded to whole output units like a real quote."""

    def __init__(self, decimals: int = DECIMALS):
        self.decimals = decimals
        self.calls = 0

    def probe(self, probes):
        out = []
        for probe in probes:
            x = probe.dx / 10**self.decimals
            y = TRUE_A * x - 0.5 * TRUE_B * x * x
            self.calls += 1
            # Rounded to whole output units, exactly like a real quote.
            out.append(Quote(Status.VALUE, int(y * 10**self.decimals)))
        return out


def arc(**kw) -> PoolArc:
    base = {
        "id": "0xpool:0>1", "pool": "0x" + "11" * 20, "kind": ArcKind.SWAP_STABLE,
        "i": 0, "j": 1, "n_coins": 2, "token_in": "0x" + "22" * 20, "token_out": "0x" + "33" * 20,
        "tau": 0, "sigma": 1, "a": TRUE_A, "B": TRUE_B, "calib_delta": 1_000_000.0,
    }
    base.update(kw)
    a = PoolArc(**base)
    a.decimals_in = a.decimals_out = DECIMALS
    return a


def run(delta: float, the_arc: PoolArc, chain: Chain):
    """Refit `the_arc` as if the solve had put `delta` of value through it."""
    psi = np.array([delta])
    nu = np.array([1.0, 1.0])
    return refit_arcs(None, [the_arc], psi, nu, chain,
                      rate_in=lambda a: 1.0, rate_out=lambda a: 1.0)


def test_a_tiny_realised_size_leaves_the_ladder_fit_alone():
    """Three dollars through a pool measured at a million teaches nothing."""
    a = arc()
    quoted, _, unresolved = run(3.0, a, Chain())
    assert (quoted, unresolved) == (0, 1)
    assert a.B == TRUE_B          # untouched
    assert not a.clamped
    assert a.cap == float("inf")  # and emphatically not capped at 3
    assert a.calib_delta == 1_000_000.0


@pytest.mark.parametrize("a_error", [+1e-7, -1e-7])
def test_a_fitted_tangent_is_what_wrecks_the_secant(a_error):
    """The floor exists because `a` is fitted, so show the damage it prevents.

    At delta = 3 the true curvature signal is `(B/2) d^2 = 2.2e-9`, while a
    tangent off by one part in ten million contributes `a d * 1e-7 = 3.0e-7` --
    a hundred times larger, and of either sign.  Below the tangent the secant
    reports `B < 0`, which is the branch that clamps the arc to a cap of 3.
    """
    x = 3.0
    a = arc(a=TRUE_A * (1 + a_error))
    f = TRUE_A * x - 0.5 * TRUE_B * x * x
    signal = a.a * x - f
    unfloored = 2.0 * signal / x**2

    assert abs(unfloored - TRUE_B) > 100 * TRUE_B     # nowhere near the truth
    assert (unfloored < 0) == (a_error < 0)           # and the sign is the error's
    assert abs(signal) <= SECANT_REL_FLOOR * a.a * x  # the floor catches it

    # And through the real code path the arc comes out untouched either way.
    quoted, _, unresolved = run(x, a, Chain())
    assert (quoted, unresolved) == (0, 1)
    assert a.B == TRUE_B and not a.clamped


def test_a_realistic_size_still_refits():
    """The floor must not disarm the refit where it works."""
    a = arc(B=TRUE_B * 4)  # a wrong incumbent the refit should correct
    quoted, _, unresolved = run(1_000_000.0, a, Chain())
    assert (quoted, unresolved) == (1, 0)
    assert a.B == pytest.approx(TRUE_B, rel=1e-6)
    assert not a.clamped
    assert a.calib_delta == 1_000_000.0


def test_a_fitted_tangent_slightly_off_does_not_flag_increasing_returns():
    """`a` is fitted; a slope above it by less than that is not convexity."""
    a = arc(a=TRUE_A * (1 - 1e-8))
    _, reflagged, _ = run(1_000_000.0, a, Chain())
    assert reflagged == 0
    assert not a.convex_flag


def test_the_floor_scales_with_the_arc_not_the_units():
    """It is relative, so a 6-decimal arc gets the same protection."""
    a = arc()
    a.decimals_in = a.decimals_out = 6
    quoted, _, unresolved = run(3.0, a, Chain(decimals=6))
    assert (quoted, unresolved) == (0, 1)
    assert a.B == TRUE_B


def test_a_delta_far_below_the_measured_range_is_not_probed_at_all():
    """The other end of the same problem, and it must not cost an RPC.

    At dust sizes the pool's own arithmetic stops being meaningful, so the
    numerator can be large in relative terms while being nonsense -- the
    signal-to-noise floor cannot catch that one.  Measured on crvUSD/USDT: a
    realised delta of 0.4 against a `calib_delta` of 3.9M read `B = 1.73`.
    """
    a = arc(calib_delta=3_898_337.0)
    chain = Chain()
    quoted, _, unresolved = run(0.4, a, chain)
    assert (quoted, unresolved) == (0, 1)
    assert chain.calls == 0        # not even probed
    assert a.B == TRUE_B and not a.clamped


def test_the_range_guard_admits_a_refit_within_the_measured_range():
    a = arc(B=TRUE_B * 4, calib_delta=1_000_000.0)
    quoted, _, unresolved = run(100_000.0, a, Chain())
    assert (quoted, unresolved) == (1, 0)
    assert a.B == pytest.approx(TRUE_B, rel=1e-6)


def test_an_arc_with_no_prior_calibration_is_still_refitted():
    """The guard is relative to a fit; with none, there is nothing to protect."""
    a = arc(B=TRUE_B * 4, calib_delta=0.0)
    quoted, _, unresolved = run(1_000_000.0, a, Chain())
    assert (quoted, unresolved) == (1, 0)
