"""Reading the rate of a coin that is not worth one.

Two failures met on mainnet, neither of which announced itself.

**A fixed-size `stored_rates()` was dropped.**  The ng pools answer with a
`DynArray`; the older factory pools answer with `uint256[N_COINS]`, which for
two coins is 64 bytes and carries no ABI header.  The reader demanded 96, so
`ETH/ETHx` -- whose oracle reports ETHx at 1.0955 ETH -- was modelled at par,
a 9.5% error the pool was announcing all along.

**A rate was checked in one direction.**  `_pick_variant` accepted a model on
`0 -> 1` alone, and a rate read from the wrong getter or scaled the wrong way
is exactly the error that flatters one leg and penalises the other.
"""

from __future__ import annotations

from erouter.chain import lending_params
from erouter.chain.stable_params import _decode_rates
from erouter.core.codec import decode
from erouter.core.quoter import Quote
from erouter.core.stableswap import StableSwap
from erouter.core.transport import Status

RATES = (10**18, 1095507299727383149)          # ETH/ETHx, as the pool reports it


def _dynamic(rates: tuple[int, ...]) -> bytes:
    """`stored_rates()` as an ng pool answers it: offset, length, items."""
    words = (32, len(rates), *rates)
    return b"".join(w.to_bytes(32, "big") for w in words)


def _fixed(rates: tuple[int, ...]) -> bytes:
    """...and as a `uint256[N_COINS]` pool answers it: just the items."""
    return b"".join(w.to_bytes(32, "big") for w in rates)


# ------------------------------------------------------------- reading rates


def test_a_fixed_size_rates_array_is_read():
    assert _decode_rates(_fixed(RATES), 2) == RATES


def test_a_dynamic_rates_array_is_still_read():
    assert _decode_rates(_dynamic(RATES), 2) == RATES


def test_the_old_spelling_cannot_read_the_fixed_shape():
    """The negative half: this is why the pools were dropped, not mis-decoded.

    Without it the fix reads as a tidy-up.  A fixed array decoded as a dynamic
    one takes the first rate for an ABI offset and finds no length word behind
    it, and it does not raise -- it hands back an empty list.  So the failure
    was never a wrong rate that the wei-exact gate would have caught: it was no
    candidate at all, and the pool fell back to par in silence.
    """
    assert decode(["uint256[]"], _fixed(RATES)) == [[]]


def test_four_coins_are_told_apart_from_two_by_the_header_not_the_length():
    """128 bytes is a two-coin dynamic array and a four-coin fixed one."""
    four = (10**18, 2 * 10**18, 3 * 10**18, 4 * 10**18)
    assert len(_fixed(four)) == len(_dynamic(RATES)) == 128
    assert _decode_rates(_fixed(four), 4) == four
    assert _decode_rates(_dynamic(RATES), 2) == RATES


def test_nothing_readable_yields_no_candidate():
    assert _decode_rates(None, 2) == ()
    assert _decode_rates(b"", 2) == ()
    assert _decode_rates(b"\x00" * 32, 2) == ()          # the quoter's truncation
    assert _decode_rates(_fixed(RATES), 3) == ()


# ------------------------------------------------- checking a rate both ways


def _shaped() -> dict:
    return {"balances": (10**24, 10**24), "rates": (10**18, 10**18), "amp": 2000 * 100,
                "fee": 4_000_000, "offpeg_fee_multiplier": 0, "a_precision": 100}


class _Pool:
    """Just enough of a `PoolSpec` for the readers under test."""

    def __init__(self, address: str, n: int = 2):
        self.address = address
        self.coins = tuple(_Coin() for _ in range(n))
        self.balances = tuple(10**24 for _ in range(n))
        self.lp_token = None
        self.swap_kind = None
        self.name = "test"


class _Coin:
    address = "0x" + "00" * 20
    decimals = 18
    symbol = "T"


class _OneWayClient:
    """Reproduces the model going `0 -> 1` and disagrees coming back.

    That is the shape of a mis-scaled rate: it cannot be wrong in both
    directions by the same amount, because one leg multiplies by it and the
    other divides.
    """

    block = 1

    def __init__(self, truth: StableSwap, *, both_ways: bool = False):
        self.truth = truth
        self.both_ways = both_ways
        self.probed: list = []

    def probe(self, probes):
        self.probed.extend(probes)
        out = []
        for p in probes:
            value = self.truth.get_dy(p.i, p.j, p.dx)
            if not self.both_ways and p.i != 0:
                value += 1
            out.append(Quote(Status.VALUE, value))
        return out


def test_a_variant_that_only_holds_one_way_is_refused():
    truth = StableSwap(fee_on_xp=True, subtract_one=True, **_shaped())
    client = _OneWayClient(truth)
    picked = lending_params._pick_variant(_Pool("0x" + "11" * 20), 2, _shaped(), client)
    assert {p.i for p in client.probed} == {0, 1}, (
        "the variant was chosen without ever asking the pool the other way"
    )
    assert picked is None, (
        "a model was admitted that reproduces the pool going one way and "
        "disagrees with it coming back"
    )


def test_a_pool_that_agrees_both_ways_is_still_admitted():
    """The other half, so the test above is not passing on a broken picker."""
    truth = StableSwap(fee_on_xp=True, subtract_one=True, **_shaped())
    picked = lending_params._pick_variant(
        _Pool("0x" + "11" * 20), 2, _shaped(), _OneWayClient(truth, both_ways=True))
    assert picked is not None
    for i, j in ((0, 1), (1, 0)):
        dx = 10**21
        assert picked.get_dy(i, j, dx) == truth.get_dy(i, j, dx)
