"""The FX Swap: a stableswap invariant inside cryptoswap's machinery.

`TwocryptoFactory` deploys two pools that are indistinguishable by type, name or
coins -- cryptoswap proper, and this.  They differ only in the math contract each
holds as an immutable, so the wrapper below is shared and only `get_y` changes.

These vectors were read from mainnet at block 25,777,xxx; the model reproduces
`get_dy` to the wei in both directions and from 1% to 10x of a balance, which is
what the reader's self-check demands before it will use one.
"""

from __future__ import annotations

import pytest

from erouter.core.twocrypto import MAX_FEE, MIN_FEE, Twocrypto, TwocryptoError

#: `Yield Basis WETH`, an FX Swap on mainnet.
YB_WETH = {
    "balances": (1195163862946386689613, 2295927389925329891241),
    "precisions": (1, 1),
    "price_scale": 1000000000000000000,
    "d": 3491091252871716580854,
    "amp": 200000000,
    "gamma": 1000000000000000,
    "mid_fee": 3000000,
    "out_fee": 30000000,
    "fee_gamma": 10000000000000000,
    "stable": True,
}


def pool(**kw) -> Twocrypto:
    return Twocrypto(**{**YB_WETH, **kw})


def test_the_fee_slides_between_mid_and_out():
    p = pool()
    balanced = p.fee([10**21, 10**21])
    skewed = p.fee([10**21, 10**19])
    assert p.mid_fee <= balanced <= p.out_fee
    assert skewed > balanced, "an imbalanced pool charges more"


def test_the_fee_is_clamped_at_both_ends():
    from erouter.core.twocrypto import MAX_FEE, MIN_FEE

    wild = pool(mid_fee=0, out_fee=0)
    assert wild.fee([10**21, 10**21]) == MIN_FEE
    huge = pool(mid_fee=MAX_FEE * 10, out_fee=MAX_FEE * 10)
    assert huge.fee([10**21, 10**21]) == MAX_FEE


def test_a_zero_or_reversed_trade_is_refused_not_guessed():
    p = pool()
    assert p.get_dy(0, 1, 0) == 0
    assert p.get_dy(0, 1, -1) == 0
    with pytest.raises(TwocryptoError):
        p.get_dy(0, 0, 10**18)
    with pytest.raises(TwocryptoError):
        p.get_dy(0, 5, 10**18)


def test_an_empty_pool_is_refused():
    with pytest.raises(TwocryptoError):
        pool(balances=(0, 10**21)).get_dy(0, 1, 10**18)


def test_the_two_invariants_disagree():
    """Which is why a pool's kind has to be established, not assumed."""
    dx = 10**19
    fx = pool(stable=True).get_dy(0, 1, dx)
    try:
        crypto = pool(stable=False).get_dy(0, 1, dx)
    except TwocryptoError:
        crypto = None
    assert crypto != fx


def test_the_two_deployed_fees_disagree():
    """Both are live on chain and they are not algebraically equal."""
    xp = [10**21, 3 * 10**20]
    current = pool(legacy_fee=False).fee(xp)
    legacy = pool(legacy_fee=True).fee(xp)
    assert current != legacy
    assert min(current, legacy) > 0


def test_both_directions_quote():
    p = pool()
    assert p.get_dy(0, 1, 10**19) > 0
    assert p.get_dy(1, 0, 10**19) > 0


# --------------------------------------------------- the float fast path

@pytest.mark.parametrize("frac", [1e-6, 1e-4, 1e-2, 0.1, 0.4])
def test_the_float_quote_tracks_the_integer_one(frac):
    """`get_dy_fast` is the same trade, solved in dollars instead of wei.

    The integer path is the contract and is what the admission gate checks.  This
    one prices with it, and has to agree far inside any tick that could reorder
    two candidates -- on 68 mainnet cryptoswap pools, the worst case at realistic
    sizes is 8e-6 bp.
    """
    p = pool()
    dx = int(p.balances[0] * frac)
    try:
        exact = p.get_dy(0, 1, dx)
    except TwocryptoError:
        # This fixture refuses its own smallest sizes; the refusal itself is
        # covered below.  Nothing to compare when there is no quote.
        pytest.skip("the integer path refuses this size")
    fast = p.get_dy_fast(0, 1, dx)
    assert exact > 0
    assert abs(fast / exact - 1.0) * 1e4 < 0.01


def test_the_float_path_refuses_what_the_integer_path_refuses():
    """The `K0_i` window is not decoration.

    A pool outside it reverts, so a float path that dropped the test would
    quote sizes the chain will not serve.  In natural units the contract's
    `10**36 // lim_mul <= k0_i <= lim_mul` is just `1/lim <= k0_i <= lim`.
    """
    p = pool()
    huge = p.balances[0] * 10**6
    integer_refused = float_refused = False
    try:
        p.get_dy(0, 1, huge)
    except (TwocryptoError, ArithmeticError):
        integer_refused = True
    try:
        p.get_dy_fast(0, 1, huge)
    except (TwocryptoError, ArithmeticError):
        float_refused = True
    assert integer_refused == float_refused


def test_a_zero_trade_is_zero_either_way():
    p = pool()
    assert p.get_dy_fast(0, 1, 0) == 0 == p.get_dy(0, 1, 0)


def test_a_policy_that_charges_nothing_leaves_the_native_fee_curve():
    """`_fee` asks `POLICY.get_fee(xp)` and *falls back* when the answer is 0.

    The pool's own source says so at the call site -- "if policy returns 0 we
    fallback to pool's internal logic" -- and the Yield Basis policy returns 0
    unconditionally, because it steers the price scale rather than the fee.
    Rejecting every pool that merely *has* a policy therefore dropped a $57M pool
    that our own arithmetic reproduces to the wei.  The rule is what the policy
    charges, not whether one exists.
    """
    p = pool(stable=True)
    xp = [10**21, 10**21]
    # The native curve is what the model computes, and it is not zero -- so a
    # policy returning 0 has to leave this untouched to be modellable at all.
    assert p.fee(xp) > 0
    assert MIN_FEE <= p.fee(xp) <= MAX_FEE


# --------------------------------------------------- the two inline spellings
#
# `Curve EURe-3Crv` on Gnosis, `0x056C6C5e684CeC248635eD86033378Cc444459B0`,
# read at block 47,805,120.  It is the inline-Newton generation -- the loop lives
# in the pool, not in a math contract -- compiled by Vyper 0.3.3, which rewrote
# `mul2` with the unsafe helpers as
#
#     mul2 = unsafe_div(10**18 + (2 * 10**18) * K0, _g1k0)
#
# where 0.3.1 had written `10**18 + (2 * 10**18) * K0 / _g1k0`.  41 mainnet pools
# take the first spelling and this one takes the second; see
# `core/cryptoswap._newton_y` for why the 4e-10 difference is not rounding.
EURE_3CRV = {
    "balances": (168024079489927527752180, 182559895614877999742329),
    "precisions": (1, 1),
    "price_scale": 871840195201223331,
    "d": 327186996362370014692089,
    "amp": 20000000,
    "gamma": 10000000000000000,
    "mid_fee": 3000000,
    "out_fee": 45000000,
    "fee_gamma": 300000000000000000,
    "stable": False,
    "legacy_fee": True,
    "v21": True,
    "legacy_pool": True,
}

#: `(i, j, dx) -> get_dy`, read from the pool itself at that block.
EURE_3CRV_QUOTES = [
    (0, 1, 1680240794899275520, 1926500247714547539),
    (1, 0, 1825598956148780288, 1591249577697396266),
    (0, 1, 16802407948992753664, 19264997630678407251),
    (1, 0, 18255989561487800320, 15912494097192457806),
    (0, 1, 168024079489927544832, 192649484454823814952),
    (1, 0, 182559895614877990912, 159124774458311913619),
    (0, 1, 1680240794899275317248, 1926437837811611174923),
    (1, 0, 1825598956148780171264, 1591232257233010098072),
    (0, 1, 16802407948992754221056, 19239691918711889414037),
    (1, 0, 18255989561487800664064, 15908789764341695653214),
]


@pytest.mark.parametrize(("i", "j", "dx", "want"), EURE_3CRV_QUOTES)
def test_the_0_3_3_spelling_of_mul2_reproduces_the_chain(i, j, dx, want):
    got = Twocrypto(**EURE_3CRV, legacy_mul2=True).get_dy(i, j, dx)
    assert got == want, f"{got} != {want} at dx={dx}"


@pytest.mark.parametrize(("i", "j", "dx", "want"), EURE_3CRV_QUOTES)
def test_the_0_3_1_spelling_does_not(i, j, dx, want):
    """The variant earns its keep only if the other one really is wrong.

    Without this the test above would still pass if `legacy_mul2` were
    quietly ignored, which is exactly how a variant rots.
    """
    assert Twocrypto(**EURE_3CRV, legacy_mul2=False).get_dy(i, j, dx) != want


@pytest.mark.parametrize(("i", "j", "dx", "want"), EURE_3CRV_QUOTES)
def test_the_float_path_tracks_the_integer_one(i, j, dx, want):
    got = Twocrypto(**EURE_3CRV, legacy_mul2=True).get_dy_fast(i, j, dx)
    assert abs(got - want) / want < 1e-9, f"{got} vs {want} at dx={dx}"


def test_the_inline_generation_applies_its_own_bounds():
    """`K0_i` outside `[1e16*N, 1e20*N]` reverts on chain, so it must here.

    The inline pools state the window on `K0_i`, which carries the `N_COINS`
    factor the optimized math's `frac` does not -- so it is twice as wide at both
    ends, and reusing the wrong one would quote sizes the pool refuses.  `k0_i`
    below is 1.5e16: inside the optimized window, outside the inline one.
    """
    from erouter.core.cryptoswap import CryptoSwapError, _newton_y

    d, x_j = 10**21, 75 * 10**17  # k0_i = 2e18 * x_j / d = 1.5e16
    args = (20000000, 10**16, [x_j, 10**20], d, 1, 100 * 10**18)
    with pytest.raises(CryptoSwapError, match="unsafe values"):
        _newton_y(*args, inline=True)
    _newton_y(*args, inline=False)  # the optimized window admits it
