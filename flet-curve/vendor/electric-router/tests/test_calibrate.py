"""Spec §2.3 / §2.4 / §2.6 calibration, and three of the §13.1 tests.

The clamp test is the one that matters most here: it fails silently under a
plausible-looking implementation, and the bug it catches is invisible without
explicitly checking the *tangent* variant too.
"""

from __future__ import annotations

import math

import numpy as np
import pytest

from erouter.core.calibrate import (
    Calibration,
    CalibrationError,
    asym,
    calibrate,
    model_output,
    peg_boundary,
    second_divided_differences,
)
from erouter.core.graph import arc_params
from erouter.core.types import FlagReason
from synthetic import CPMM, ConvexArc, DynamicFeeCPMM, geometric_grid, ladder

# ------------------------------------------------------------ the basic fit


def test_secant_fit_recovers_cpmm_parameters():
    pool = CPMM(x_out=2_000_000.0, y_in=1_000_000.0, fee=0.0003)
    xs, ys = ladder(pool, geometric_grid(pool.y_in))
    fit = calibrate(xs, ys)

    assert fit.a == pytest.approx(pool.a, rel=1e-5)  # tangent from the tiny probe
    # The secant fit is anchored at d_bar, so it sits slightly below |f''(0)|.
    assert 0 < fit.B < pool.B
    assert fit.B == pytest.approx(pool.B / (1 + pool.theta(xs[-1])), rel=1e-3)
    assert not fit.convex_flag
    assert not fit.clamped


def test_eta_is_the_family_fingerprint():
    """`eta = f' f''' / (f'')^2` is 3/2 for constant product, identically.

    §2.4: `f''' = 3(f'')^2 / (2f')` for the whole family, so eta is a fingerprint
    rather than a fitted quantity.  The ladder estimates it by divided
    differences, so it converges to 3/2 as the ladder tightens -- and a value
    outside (1, 2), or one that moves with delta, means a non-smooth feature is
    nearby and the arc should be split (§12.2).
    """
    pool = CPMM(x_out=5_000_000.0, y_in=5_000_000.0, fee=0.0)

    def eta_at(theta):
        d = theta * pool.y_in
        return calibrate(*ladder(pool, [1e-6 * pool.y_in, d / 4, d / 2, d])).eta

    assert eta_at(0.01) == pytest.approx(1.5, rel=0.05)
    assert 1.0 < eta_at(0.01) < 2.0
    # monotone convergence from above as the sampled range shrinks
    assert 1.5 < eta_at(0.01) < eta_at(0.03) < eta_at(0.10)


def test_secant_beats_tangent_on_accuracy(subtests=None):
    """§2.4's budget: the tangent is ~4x worse, and errs the other way."""
    pool = CPMM(x_out=1_000_000.0, y_in=1_000_000.0, fee=0.0)
    for theta in (0.01, 0.03, 0.05, 0.10):
        d_bar = theta * pool.y_in
        xs, ys = ladder(pool, [1e-6 * pool.y_in, d_bar / 4, d_bar / 2, d_bar])
        fit = calibrate(xs, ys)

        # secant is exact at both anchors
        assert model_output(fit, d_bar) == pytest.approx(pool.f(d_bar), rel=1e-6)
        # tangent under-promises by ~theta^2
        tangent = Calibration(a=pool.a, B=pool.B)
        ratio = model_output(tangent, d_bar) / pool.f(d_bar)
        assert ratio == pytest.approx(1 - theta**2, rel=0.05)
        assert ratio < 1.0  # the safe direction


def test_a_comes_from_the_smallest_successful_probe():
    """6% of mainnet arcs fail at 1e-6*reserve, and a couple return zero.

    A zero `a` would poison log(a) in the reference-price fit, so the fit takes
    the smallest node that actually answered and records which one it was.
    """
    pool = CPMM(x_out=1e6, y_in=1e6, fee=0.0)
    grid = geometric_grid(pool.y_in)
    xs, ys = ladder(pool, grid[2:])  # pretend the two smallest probes failed
    fit = calibrate(xs, ys)
    assert fit.tangent_delta == grid[2]
    assert fit.a < pool.a  # a chord over a wider interval, i.e. conservative


# ------------------------------------------------------- the clamp (§13.1)


def test_clamp_is_an_upper_bound_and_the_tangent_variant_is_not():
    """The §13.1 test that is invisible without checking both variants.

    Clamping B to 0 while keeping a = f'(0) leaves the *tangent*, which on a
    convex piece lies BELOW the curve -- an under-estimate that makes the solver
    silently skip the arc.  The chord is exact at both endpoints and above the
    curve between, so it is a valid concave majorant: an upper bound cannot
    prune the true optimum.
    """
    arc = ConvexArc(a0=1.0, c=1e-3, cap=500.0)
    xs, ys = ladder(arc, [1e-3, 50.0, 150.0, 300.0, 500.0])
    fit = calibrate(xs, ys, cap=arc.cap, f_at_cap=arc.f(arc.cap))

    assert fit.clamped and fit.B == 0.0
    assert fit.convex_flag
    assert fit.flag_reason in (FlagReason.CLAMPED, FlagReason.BOTH)
    assert fit.a == pytest.approx(arc.chord_slope)

    probes = np.linspace(0.0, arc.cap, 51)[1:]
    clamped = np.array([model_output(fit, d) for d in probes])
    truth = np.array([arc.f(d) for d in probes])
    assert np.all(clamped >= truth - 1e-12)  # a majorant everywhere
    assert model_output(fit, arc.cap) == pytest.approx(arc.f(arc.cap))  # exact at cap
    assert np.any(clamped > truth * (1 + 1e-9))  # and strictly above in between

    # ... and the tangent variant violates the bound, which is the whole point.
    tangent = Calibration(a=arc.tangent_slope, B=0.0, cap=arc.cap, clamped=True)
    below = np.array([model_output(tangent, d) for d in probes])
    assert np.any(below < truth - 1e-12)


def test_clamped_arc_defaults_its_cap_to_the_last_probed_node():
    """A B=0 arc has no self-limiting term, so a cap is mandatory, not optional."""
    arc = ConvexArc(a0=1.0, c=1e-3, cap=1_000.0)
    xs, ys = ladder(arc, [1e-3, 100.0, 300.0, 600.0])
    fit = calibrate(xs, ys)  # no cap supplied
    assert fit.clamped
    assert fit.cap == 600.0
    assert fit.note == "CAP_FROM_LADDER"
    assert math.isfinite(fit.cap)


def test_a_clamped_calibration_cannot_be_built_without_a_finite_cap():
    with pytest.raises(CalibrationError, match="finite cap"):
        Calibration(a=1.0, B=0.0, cap=math.inf, clamped=True)


def test_negative_curvature_can_never_leave_calibration():
    """The invariant that makes G < 0 structurally impossible.

    calibrate() is the only place a B is produced, so enforcing it here means
    the solver never has to guard against an indefinite Laplacian.
    """
    with pytest.raises(CalibrationError, match="clamped to 0"):
        Calibration(a=1.0, B=-1e-9)

    arc = ConvexArc(a0=1.0, c=1e-2, cap=100.0)
    xs, ys = ladder(arc, [1e-3, 10.0, 50.0, 100.0])
    fit = calibrate(xs, ys)
    assert fit.B == 0.0  # clamped, not negative

    # and the graph accepts it, giving an infinite (later ceilinged) G
    G, _ = arc_params(
        np.array([0]), np.array([1]), np.array([fit.a]), np.array([fit.B]), np.ones(2)
    )
    assert np.isinf(G[0])


# ------------------------------------------------- non-concavity detection


def test_divided_differences_detect_increasing_returns():
    arc = ConvexArc(a0=1.0, c=1e-3, cap=1000.0)
    xs, ys = ladder(arc, [1.0, 100.0, 300.0, 600.0])
    D = second_divided_differences(
        np.array([0.0, *xs]), np.array([0.0, *ys])
    )
    assert np.all(D > 0)  # convex everywhere on the sampled range

    pool = CPMM(x_out=1e6, y_in=1e6, fee=0.0)
    xs, ys = ladder(pool, geometric_grid(pool.y_in))
    D = second_divided_differences(np.array([0.0, *xs]), np.array([0.0, *ys]))
    assert np.all(D < 0)  # concave, as a real pool must be


def test_structural_flag_is_honoured_even_when_the_probes_look_clean():
    """Belt and braces: a narrow defect can hide between grid nodes.

    A local ladder cannot see a chord that spans two decades, so pool metadata
    (outFee != midFee and the trade rebalances) sets the flag independently.
    """
    pool = CPMM(x_out=1e6, y_in=1e6, fee=0.0003)
    xs, ys = ladder(pool, geometric_grid(pool.y_in))
    clean = calibrate(xs, ys)
    assert not clean.convex_flag

    flagged = calibrate(xs, ys, structural_flag=True)
    assert flagged.convex_flag
    assert flagged.flag_reason is FlagReason.STRUCTURAL
    assert flagged.B == clean.B  # the flag is a label, not a different model


def test_exactly_one_direction_of_a_dynamic_fee_pool_is_flagged():
    """§13.1: both flagged, or neither, is a bug in the structural test.

    The rebalancing side has the fee falling with size (convex contribution);
    the imbalancing side has it rising, which adds concavity on top of the
    curve's own and leaves the arc better behaved than a plain CPMM.
    """
    # A caricature of the real effect -- the test is about the detector, not
    # about realistic fee levels.
    rebalancing = DynamicFeeCPMM(x_out=1e6, y_in=1e6, base_fee=0.10, slope=2.0)
    imbalancing = DynamicFeeCPMM(x_out=1e6, y_in=1e6, base_fee=0.10, slope=-2.0)

    grid = geometric_grid(1e6)
    fit_rebalance = calibrate(*ladder(rebalancing, grid))
    fit_imbalance = calibrate(*ladder(imbalancing, grid))

    assert fit_rebalance.convex_flag, "the rebalancing side must be flagged"
    assert not fit_imbalance.convex_flag, "the imbalancing side must not be"
    assert fit_rebalance.clamped
    assert fit_imbalance.B > 0


# ------------------------------------------------------- reciprocity (§13.1)


def test_reciprocity_on_a_lopsided_cpmm():
    """A 1:1 pool passes this trivially and is worthless, so use x0/y0 = 3000.

    `a` and `B` are wildly asymmetric -- B differs by three powers of the price
    -- but value conductance is direction-symmetric.  That is the third
    independent argument for working in value coordinates.
    """
    ratio = 3000.0
    fee = 0.003
    forward = CPMM(x_out=ratio * 1e6, y_in=1e6, fee=fee)
    reverse = forward.reverse()
    gamma = forward.retention

    assert forward.a * reverse.a == pytest.approx(gamma**2)  # < 1: round trips lose
    assert forward.a * reverse.a < 1.0
    assert reverse.B == pytest.approx(forward.B * gamma**3 / forward.a**3)  # (M8)

    # asymmetric by orders of magnitude -- never reuse B across directions
    assert reverse.B / forward.B == pytest.approx(ratio**-3, rel=1e-9)
    assert reverse.B / forward.B < 1e-9

    assert asym(forward.a, reverse.a, forward.B, reverse.B) == pytest.approx(0.0, abs=1e-12)

    # ... and yet G_f == G_r exactly, in the pool's own mid frame (M9)
    nu_in = forward.a / gamma  # price of the input token, output token = 1
    G_f = nu_in * forward.a / forward.B
    G_r = 1.0 * reverse.a / reverse.B
    assert G_f == pytest.approx(G_r, rel=1e-12)


def test_asym_is_nonzero_for_a_genuinely_asymmetric_pool():
    """A different fee each way is real asymmetry, and must be visible."""
    forward = CPMM(x_out=3e9, y_in=1e6, fee=0.003)
    reverse = CPMM(x_out=1e6, y_in=3e9, fee=0.03)  # 10x sell tax
    assert abs(asym(forward.a, reverse.a, forward.B, reverse.B)) > 0.01


# ------------------------------------------------------------- the peg (§2.5)


def test_peg_boundary_is_found_where_curvature_jumps():
    """§2.5's "most dangerous single mis-calibration", turned into a measurement."""
    flat_until = 200_000.0

    class Pegged:
        """Deep and nearly linear inside the peg, shallow outside it."""

        @staticmethod
        def f(d):
            if d <= flat_until:
                return CPMM(x_out=1e12, y_in=1e12).f(d)
            edge = CPMM(x_out=1e12, y_in=1e12).f(flat_until)
            return edge + CPMM(x_out=1e6, y_in=1e6).f(d - flat_until)

    xs, ys = ladder(Pegged, [1e3, 5e4, 1.5e5, 2.5e5, 5e5, 1e6])
    boundary = peg_boundary(xs, ys)
    assert boundary is not None
    assert 1.5e5 <= boundary <= 5e5

    # A pool that is uniformly curved must NOT report a boundary.
    pool = CPMM(x_out=1e6, y_in=1e6)
    assert peg_boundary(*ladder(pool, geometric_grid(1e6))) is None


def test_drift_flags_a_curve_whose_second_derivative_moves():
    pool = CPMM(x_out=1e6, y_in=1e6, fee=0.0)
    fit = calibrate(*ladder(pool, [1e0, 1e3, 1e4, 3e4]))
    assert abs(fit.drift) > 0.0
    big = calibrate(*ladder(pool, [1e0, 1e4, 1e5, 5e5]))
    assert abs(big.drift) > abs(fit.drift)  # sampling further out drifts more


# ------------------------------------------------------------- input guards


@pytest.mark.parametrize(
    ("deltas", "quotes", "match"),
    [
        ([1.0], [1.0], "at least 2"),
        ([1.0, 1.0, 2.0], [1.0, 2.0, 3.0], "strictly increasing"),
        ([1.0, 2.0, 3.0], [1.0, 0.0, 3.0], "positive"),
        ([1.0, 2.0, 3.0], [1.0, 2.0], "same length"),
    ],
)
def test_bad_ladders_are_rejected(deltas, quotes, match):
    with pytest.raises(CalibrationError, match=match):
        calibrate(deltas, quotes)


def test_a_saturating_quote_becomes_a_capped_arc():
    """`get_dy` that stops rising is a wall, not a curve.

    Measured on a LLAMMA WETH market: `get_dy` returned 11.472806 crvUSD for
    every input from 0.039 WETH to 38.7, a thousandfold range, because only that
    much crvUSD stood in reachable bands.  Fitting through those points reads the
    marginal rate as 296 crvUSD/WETH when it is nearer 1,900, and §4's log-price
    fit then drags the whole reference frame with it.  The arc is still routable
    up to the wall -- that is what `cap` is for (§2.3 rule 2).
    """
    deltas = [0.000387, 0.038737, 0.387368, 3.873677, 38.736766]
    quotes = [0.508730, 11.472806, 11.472806, 11.472806, 11.472806]

    fit = calibrate(deltas, quotes)

    assert math.isfinite(fit.cap), "a saturating arc must be capped"
    assert fit.cap == pytest.approx(0.038737), fit.cap
    assert fit.clamped
    # `a` is the CHORD to the wall, not the tangent at the origin.  §2.3 picks
    # the chord so the model is exact at `cap` and conservative below it: the
    # tangent here is 1,314, which would have the model promise 50.9 crvUSD
    # where the chain pays 11.47.  Under-promising is the safe direction, and
    # the on-chain quote adjudicates the rest.
    assert fit.a == pytest.approx(11.472806 / 0.038737, rel=1e-9)
    assert fit.a * fit.cap == pytest.approx(11.472806, rel=1e-9), "exact at the cap"


def test_a_healthy_curve_is_not_mistaken_for_a_wall():
    """Diminishing returns must not read as saturation."""
    deltas = [1.0, 10.0, 100.0, 1000.0]
    quotes = [1.0, 9.99, 99.5, 985.0]

    fit = calibrate(deltas, quotes)

    assert not math.isfinite(fit.cap) or fit.cap >= deltas[-1]
    assert fit.note != "SATURATED"


def test_a_repeated_ladder_node_is_not_a_wall():
    """The same probe twice is one probe, not evidence of saturation.

    `merge` drops duplicate ladder nodes, but it keys on exact integer wei while
    the refine pass computes its sizes as floats -- so a refined node landing on
    a grid node arrives a few wei off and survives.  The wall test then compares
    two quotes for the same size, sees no increase, and clamps.

    Measured on tac, WTAC->USDT: the arc was capped at a tenth of the trade, the
    only path out of WTAC could no longer carry it, and the CLI reported "src
    not connected to dst" for a swap the pool quotes happily.
    """
    # 3,026.306608... twice, a few wei apart, exactly as the ladder built it.
    deltas = [1513.153304, 3026.306608, 3026.3066080001, 6052.613217, 302630.660842]
    quotes = [4.156231, 8.312002, 8.312002, 16.622160, 822.014609]

    fit = calibrate(deltas, quotes)

    assert fit.note != "SATURATED", "a repeated node is not a capacity wall"
    assert not fit.clamped
    assert not math.isfinite(fit.cap), "a healthy concave arc needs no cap"
    assert fit.B > 0
    # The rate is still the small-node tangent, unchanged by the duplicate.
    assert fit.a == pytest.approx(4.156231 / 1513.153304, rel=1e-9)


def test_a_wall_is_still_a_wall_when_the_ladder_repeats_a_node():
    """Collapsing duplicates must not blind the wall test to a real wall."""
    deltas = [0.000387, 0.038737, 0.0387370001, 0.387368, 3.873677]
    quotes = [0.508730, 11.472806, 11.472806, 11.472806, 11.472806]

    fit = calibrate(deltas, quotes)

    assert fit.clamped and math.isfinite(fit.cap)
    assert fit.cap == pytest.approx(0.038737), fit.cap


def test_a_ladder_of_one_repeated_size_is_rejected():
    """Nothing can be fitted through a single size, however many times probed."""
    with pytest.raises(CalibrationError, match="distinct sizes"):
        calibrate([100.0, 100.0000001], [1.0, 1.0])


def test_output_rounding_is_not_increasing_returns():
    """A coarse output token must not make a healthy pool look convex.

    Mainnet 3Crv -> GUSD, verbatim from the coarse pass.  GUSD has *two*
    decimals, so each quote is rounded down by up to 0.01, and at the small node
    that is 1.5e-4 of the rate -- which propagates into `a` and fakes a curvature
    of -2.9e-8 against a noise floor of 4.8e-8.  Clamping on that evidence made
    $10,000 of a pool holding 393,473 GUSD unroutable.
    """
    deltas = [64.823756, 6482.375563]
    quotes = [67.330000, 6733.620000]

    fit = calibrate(deltas, quotes, quantum=0.01)

    assert fit.note == "QUANTISED"
    assert not fit.clamped, "the curvature is unmeasured, not negative"
    assert fit.B > 0, "a usable arc needs a finite conductance"
    assert not math.isfinite(fit.cap) or fit.cap >= deltas[-1]


def test_a_real_convexity_still_clamps_through_the_noise():
    """The floor must not swallow curvature a coarse token *can* resolve."""
    # The same shape, an order of magnitude more convex than rounding explains.
    deltas = [64.823756, 6482.375563]
    quotes = [67.330000, 6740.000000]

    fit = calibrate(deltas, quotes, quantum=0.01)

    assert fit.clamped and math.isfinite(fit.cap)
    assert fit.note != "QUANTISED"


def test_eighteen_decimals_are_unaffected():
    """The floor is nothing on a token that quotes to the wei."""
    deltas = [1.0, 100.0, 1000.0]
    quotes = [1.0, 99.9, 998.0]

    fine = calibrate(deltas, quotes, quantum=1e-18)
    none = calibrate(deltas, quotes)

    assert fine.B == none.B and fine.a == none.a
    assert fine.note == none.note
