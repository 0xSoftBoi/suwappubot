"""Spec §4 reference prices, and the §2.6 guards they exist to make rare."""

from __future__ import annotations

import numpy as np
import pytest

from erouter.core.graph import arc_params
from erouter.core.prices import (
    check_pair_drops,
    dislocations,
    gamma_live,
    reference_prices,
)


def both_directions(pairs, rates, weights):
    """Build arc arrays with each pool appearing in both directions.

    Half weight per direction, so a pool's influence is not doubled.
    """
    tau, sig, a, w = [], [], [], []
    for (t, s), (af, ar), weight in zip(pairs, rates, weights, strict=True):
        tau += [t, s]
        sig += [s, t]
        a += [af, ar]
        w += [weight / 2, weight / 2]
    return (
        np.array(tau, np.int64),
        np.array(sig, np.int64),
        np.array(a, float),
        np.array(w, float),
    )


def test_single_pool_lands_on_the_fee_free_mid():
    """The two one-sided quotes bracket the mid by +/- log(Gamma); LS sits in
    the middle.  Using one direction only would bias every price by the fee."""
    fee = 0.003
    true_price = 2000.0  # node0 is worth 2000 node1
    a_f = true_price * (1 - fee)
    a_r = (1 / true_price) * (1 - fee)

    tau, sig, a, w = both_directions([(0, 1)], [(a_f, a_r)], [1e6])
    nu = reference_prices(tau, sig, a, w, 2, numeraire=1)

    assert nu[1] == pytest.approx(1.0)
    assert nu[0] == pytest.approx(true_price)  # not 2000*(1-fee), the mid
    assert np.log(nu[0]) == pytest.approx(0.5 * (np.log(a_f) - np.log(a_r)))


def test_one_sided_fit_is_biased_by_the_fee():
    """Contrast: this is what the both-directions rule buys."""
    fee = 0.003
    true_price = 2000.0
    a_f = true_price * (1 - fee)
    tau = np.array([0], np.int64)
    sig = np.array([1], np.int64)
    nu = reference_prices(tau, sig, np.array([a_f]), np.array([1.0]), 2, numeraire=1)
    assert nu[0] == pytest.approx(a_f)
    assert nu[0] < true_price * (1 - fee / 2)  # systematically off, by the fee


def test_gamma_live_reads_the_fee_off_two_probes():
    """No fee parameters, no ABI knowledge of the fee law -- just two quotes."""
    fee = 0.0004
    price = 3.7
    a_f, a_r = price * (1 - fee), (1 / price) * (1 - fee)
    assert gamma_live(a_f, a_r) == pytest.approx(1 - fee)
    assert a_f * a_r < 1.0  # round-tripping always loses


def test_deep_pools_dominate_the_frame():
    """A manipulated shallow pool must not move the reference prices."""
    honest = 100.0
    manipulated = 50.0
    tau, sig, a, w = both_directions(
        [(0, 1), (0, 1)],
        [(honest, 1 / honest), (manipulated, 1 / manipulated)],
        [1e9, 1e3],  # deep vs dust
    )
    nu = reference_prices(tau, sig, a, w, 2, numeraire=1)
    assert nu[0] == pytest.approx(honest, rel=2e-3)


def test_consistent_triangle_is_reproduced_exactly():
    """Three tokens, arbitrage-free quotes: the fit must recover them."""
    p01, p12 = 5.0, 7.0
    tau, sig, a, w = both_directions(
        [(0, 1), (1, 2), (0, 2)],
        [(p01, 1 / p01), (p12, 1 / p12), (p01 * p12, 1 / (p01 * p12))],
        [1e6, 1e6, 1e6],
    )
    nu = reference_prices(tau, sig, a, w, 3, numeraire=2)
    assert nu[2] == pytest.approx(1.0)
    assert nu[1] == pytest.approx(p12)
    assert nu[0] == pytest.approx(p01 * p12)
    assert np.max(np.abs(dislocations(tau, sig, a, nu))) < 1e-12


def test_inconsistent_triangle_splits_the_residual():
    """An inconsistent quote shows up as a residual, not as a wrong frame."""
    tau, sig, a, w = both_directions(
        [(0, 1), (1, 2), (0, 2)],
        [(5.0, 0.2), (7.0, 1 / 7), (40.0, 1 / 40)],  # 5*7 = 35, not 40
        [1e6, 1e6, 1e6],
    )
    nu = reference_prices(tau, sig, a, w, 3, numeraire=2)
    residual = dislocations(tau, sig, a, nu)
    assert np.max(np.abs(residual)) > 1e-3  # the disagreement is visible
    assert 35.0 < nu[0] < 40.0  # and split, not resolved in favour of one path


def test_zero_marginal_rate_is_rejected_loudly():
    """A failed probe must drop the arc, never enter the fit as a = 0.

    log(0) would NaN the whole reference frame, and 6% of arcs fail their
    smallest probe on mainnet -- this is a live concern, not a hypothetical.
    """
    tau = np.array([0, 1], np.int64)
    sig = np.array([1, 0], np.int64)
    with pytest.raises(ValueError, match="a > 0"):
        reference_prices(tau, sig, np.array([1.0, 0.0]), np.ones(2), 2, numeraire=1)


def test_disconnected_nodes_keep_unit_price():
    tau = np.array([0], np.int64)
    sig = np.array([1], np.int64)
    nu = reference_prices(tau, sig, np.array([2.0]), np.array([1.0]), 4, numeraire=1)
    assert nu[2] == 1.0 and nu[3] == 1.0


# ----------------------------------------------------- the §2.6 guard


def test_consistent_frame_gives_positive_pair_drops():
    fee = 0.003
    price = 2000.0
    a_f, a_r = price * (1 - fee), (1 / price) * (1 - fee)
    tau, sig, a, w = both_directions([(0, 1)], [(a_f, a_r)], [1e6])
    nu = reference_prices(tau, sig, a, w, 2, numeraire=1)

    _, eps = arc_params(tau, sig, a, np.ones(2), nu)
    assert eps[0] + eps[1] == pytest.approx(2 * fee, rel=1e-6)  # 2(1 - Gamma)
    assert check_pair_drops(eps[:1], eps[1:]).size == 0


def test_bad_nu_manufactures_a_spurious_negative_two_cycle():
    """The bug the guard exists to catch.

    eps_f + eps_r is maximal at the pool's own mid and falls below zero when nu
    is far enough off.  The solver would then see a two-arc negative cycle that
    does not exist and allocate flow around it.
    """
    fee = 0.003
    price = 2000.0
    a_f, a_r = price * (1 - fee), (1 / price) * (1 - fee)
    tau = np.array([0, 1], np.int64)
    sig = np.array([1, 0], np.int64)
    a = np.array([a_f, a_r])

    good = np.array([price, 1.0])
    _, eps_good = arc_params(tau, sig, a, np.ones(2), good)
    assert check_pair_drops(eps_good[:1], eps_good[1:]).size == 0

    skewed = np.array([price * 10, 1.0])  # one token's nu perturbed 10x
    _, eps_bad = arc_params(tau, sig, a, np.ones(2), skewed)
    assert eps_bad[0] + eps_bad[1] < 0
    assert check_pair_drops(eps_bad[:1], eps_bad[1:]).size == 1


def test_the_both_directions_fit_does_not_produce_the_perturbation():
    """And the §4 fit is what makes the guard rarely fire in the first place."""
    fee = 0.003
    price = 2000.0
    tau, sig, a, w = both_directions(
        [(0, 1)], [(price * (1 - fee), (1 / price) * (1 - fee))], [1e6]
    )
    nu = reference_prices(tau, sig, a, w, 2, numeraire=1)
    _, eps = arc_params(tau, sig, a, np.ones(2), nu)
    assert eps[0] + eps[1] > 0
    # the mid is exactly the frame that maximises eps_f + eps_r
    for skew in (0.5, 0.9, 1.1, 2.0):
        _, other = arc_params(tau, sig, a, np.ones(2), np.array([nu[0] * skew, 1.0]))
        assert other[0] + other[1] <= eps[0] + eps[1] + 1e-12


def test_a_contradictory_arc_pair_is_muted_in_the_fit():
    """A pool whose two directions disagree must not set the price frame.

    §4 fits log-prices by weighted least squares, so one arc claiming WETH is
    worth 296 crvUSD drags the whole frame -- and the frame sets `eps` and `G` for
    *every* arc, not only the liar.  `a_f * a_r` is `Gamma_live^2` and sits just
    under 1 for any symmetric-fee CFMM; on mainnet LLAMMA markets, which quote
    from whichever band is live, it is 0.0006.  §12.2c guards the other side of
    this (`a_f * a_r < 1`); this is the same invariant read downward.
    """
    from erouter.core.prices import MUTED_WEIGHT, price_fit_weights

    # Two pools joining the same node pair -- the common case, and the one
    # that node-keyed pairing gets wrong.
    keys = [("healthy", 0, 1), ("healthy", 1, 0), ("banded", 0, 1), ("banded", 1, 0)]
    a = np.array([1.0, 0.999, 296.0, 2.08e-6])
    w = np.array([1e6, 1e6, 1e6, 1e6])

    out = price_fit_weights(keys, a, w)

    assert out[0] == 1e6 and out[1] == 1e6, "muted a healthy pool"
    assert out[2] == MUTED_WEIGHT and out[3] == MUTED_WEIGHT, out


def test_muting_leaves_the_price_frame_where_the_honest_pools_put_it():
    """The muted arc must not move `nu`, but must not disconnect it either."""
    from erouter.core.prices import price_fit_weights, reference_prices

    # 0 -- 1 priced at 2.0 by two honest pools, and libelled by a third.
    tau = np.array([0, 1, 0, 1, 0, 1], dtype=np.int64)
    sig = np.array([1, 0, 1, 0, 1, 0], dtype=np.int64)
    a = np.array([2.0, 0.4995, 2.0, 0.4995, 50.0, 1.2e-5])
    w = np.full(6, 1e6)

    keys = [("p1", 0, 1), ("p1", 1, 0), ("p2", 0, 1), ("p2", 1, 0),
            ("banded", 0, 1), ("banded", 1, 0)]
    honest = reference_prices(tau[:4], sig[:4], a[:4], w[:4], 2, 1)
    muted = reference_prices(tau, sig, a, price_fit_weights(keys, a, w), 2, 1)

    assert muted[0] == pytest.approx(honest[0], rel=1e-6), (muted, honest)
    assert np.all(np.isfinite(muted))
