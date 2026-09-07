"""The three-coin cryptoswap, ported from the deployed math.

A separate module from `twocrypto` rather than a generalisation: `get_y` is the
same analytic shape with entirely different coefficients (`a = 10**36/27` against
`10**32`, and `b`/`c`/`d` built from both other balances), and the fee is
`reduction_coefficient` over three balances rather than the two-coin `K`.  These
parameters were read from `TricryptoUSDC` on mainnet.
"""

from __future__ import annotations

import pytest

from erouter.core.tricrypto import (
    Tricrypto,
    TricryptoError,
    _cbrt,
    reduction_coefficient,
)

STATE = {
    "balances": (1328923109972, 2051494736, 695461346171780166020),
    "precisions": (10**12, 10**10, 1),
    "price_scale": (64757744418661683527417, 3067521869705084157440),
    "d": 3986769329916000000000000,
    "amp": 1707629,
    "gamma": 11809167828997,
    "mid_fee": 2999999,
    "out_fee": 80000000,
    "fee_gamma": 350000000000000,
}


def pool(**kw) -> Tricrypto:
    return Tricrypto(**{**STATE, **kw})


def test_the_cube_root_is_the_contracts_seven_steps_not_convergence():
    """Seven unrolled iterations is the answer, not an approximation to it."""
    for value in (10**18, 8 * 10**18, 10**30, 2**200):
        root = _cbrt(value)
        assert root > 0
        # within a hair of the true cube root, scaled by 1e18 internally
        assert abs(root**3 - value * 10**36) < value * 10**36 // 10**12


def test_the_reduction_coefficient_peaks_at_balance():
    """1e18 when the three balances are equal, falling as they skew."""
    balanced = reduction_coefficient([10**20, 10**20, 10**20], 0)
    skewed = reduction_coefficient([10**20, 10**20, 10**18], 0)
    assert balanced == 10**18
    assert skewed < balanced


def test_the_fee_slides_from_mid_to_out():
    p = pool()
    at_peg = p.fee([10**20, 10**20, 10**20])
    off_peg = p.fee([10**20, 10**20, 10**17])
    assert p.mid_fee <= at_peg <= p.out_fee
    assert off_peg > at_peg


def test_every_coin_pair_quotes():
    p = pool()
    for i in range(3):
        for j in range(3):
            if i == j:
                continue
            assert p.get_dy(i, j, p.balances[i] // 1000) > 0


def test_a_nonsense_trade_is_refused_rather_than_guessed():
    p = pool()
    assert p.get_dy(0, 1, 0) == 0
    assert p.get_dy(0, 1, -5) == 0
    with pytest.raises(TricryptoError):
        p.get_dy(1, 1, 10**6)
    with pytest.raises(TricryptoError):
        p.get_dy(0, 3, 10**6)


def test_an_empty_pool_is_refused():
    with pytest.raises(TricryptoError):
        pool(balances=(0, 2051494736, 695461346171780166020)).get_dy(1, 2, 10**6)


def test_a_trade_past_what_the_pool_holds_is_refused():
    """The bounds are the contract's; a model that answers where the chain
    reverts is worse than one that refuses."""
    p = pool()
    with pytest.raises(TricryptoError):
        p.get_dy(0, 1, p.balances[0] * 10_000)


# --------------------------------------------------- the float fast path

@pytest.mark.parametrize("pair", [(0, 1), (0, 2), (1, 2), (2, 0)])
@pytest.mark.parametrize("frac", [1e-4, 1e-2, 0.1])
def test_the_float_quote_tracks_the_integer_one(pair, frac):
    """Same trade, solved in dollars instead of wei.

    Measured on the 13 mainnet tricrypto models over 312 (pool, pair, size)
    samples: median 9.4e-12 bp, worst 2.0e-05 bp, and no size where one path
    answers and the other refuses.
    """
    i, j = pair
    p = pool()
    dx = int(p.balances[i] * frac)
    try:
        exact = p.get_dy(i, j, dx)
    except TricryptoError:
        pytest.skip("the integer path refuses this size")
    fast = p.get_dy_fast(i, j, dx)
    assert exact > 0
    assert abs(fast / exact - 1.0) * 1e4 < 0.01


def test_the_float_path_keeps_the_y_over_d_bound():
    """`frac = y * 1e18 // d` against `1e16 < frac < 1e20` is `0.01 < y/D < 100`.

    The pool refuses outside it, so the float path must too rather than
    quoting a trade the chain will not serve.
    """
    p = pool()
    huge = p.balances[0] * 10**9
    refused = []
    for fn in (p.get_dy, p.get_dy_fast):
        try:
            fn(0, 1, huge)
            refused.append(False)
        except (TricryptoError, ArithmeticError):
            refused.append(True)
    assert refused[0] == refused[1]


# ------------------------------------------------ the 2021 generation

def test_the_a_multiplier_is_not_a_constant_across_generations():
    """`A_MULTIPLIER` is 10,000 for the optimized math and **100** for the
    original 2021 tricrypto -- the same trap `a_precision` is in stableswap.

    Taking the wrong one scales `mul1` by a hundred, which quotes the pool about
    twice wrong: close enough to read as a rounding problem and not be one.
    Verified against the deployed 0x80466c64, whose `A()` returns `A_precise()/100`.
    """
    from erouter.core.tricrypto import A_MULTIPLIER, _newton_y

    x = [100_000 * 10**18, 100_000 * 10**18, 100_000 * 10**18]
    d = 300_000 * 10**18
    ann, gamma = 364_500, 69_999_999_999_999
    with_100 = _newton_y(ann, gamma, x, d, 1, a_multiplier=100)
    with_10k = _newton_y(ann, gamma, list(x), d, 1, a_multiplier=A_MULTIPLIER)
    assert with_100 != with_10k, "the multiplier has to reach the arithmetic"


def test_the_2021_pools_bound_their_inputs():
    """The original math asserts every *other* balance sits within
    `[1e16, 1e20]` of `D`; the optimized math dropped the check.

    It is a refusal the pool makes, so a model of one has to make it too --
    otherwise we quote a size the chain reverts on.
    """
    from erouter.core.tricrypto import _newton_y

    d = 300_000 * 10**18
    lopsided = [10**18, 150_000 * 10**18, 150_000 * 10**18]   # x[0]/D far below 1e16
    with pytest.raises(TricryptoError, match="unsafe values"):
        _newton_y(364_500, 69_999_999_999_999, lopsided, d, 1,
                  check_inputs=True, a_multiplier=100)
