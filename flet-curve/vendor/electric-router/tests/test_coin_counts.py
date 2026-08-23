"""N comes from the pool, not from the listing.

The Prices listing appends a lending pool's *underlying* view to its coins and
marks it nowhere: `is_metapool` is false, `base_pool` is null, and `pool_index`
just counts on past the real coins.  So `cDAI/cUSDC/USDT` arrives claiming five
coins and answers `coins(3)` with a revert.

That is not a cosmetic count.  N is in the stableswap invariant and in the
`uint256[N]` an `add_liquidity` sends, and it decides which `(i, j)` pairs
become arcs -- measured, 40 arcs across ethereum and polygon named indices that
do not exist.  They quote REVERTED and get dropped, so nothing shipped wrong;
the guard was an accident rather than a design.
"""

from __future__ import annotations

from erouter.core.pools import PoolSpec
from erouter.core.transport import Answer, Status
from erouter.dev.universe import resolve_coin_counts


class Pool:
    """Answers `coins(i)` for the first `n`, reverts past it."""

    def __init__(self, real: list[str], spelling: str = "coins(uint256)"):
        self.real = real
        self.spelling = spelling
        self.asked = 0

    def raw(self, calls):
        from erouter.core.codec import encode_call

        out = []
        for call in calls:
            self.asked += 1
            hit = None
            for k, addr in enumerate(self.real):
                if bytes(call.data) == encode_call(self.spelling, k):
                    hit = addr
                    break
            if hit is None:
                out.append(Answer(Status.REVERTED, b""))
            else:
                out.append(Answer(Status.VALUE, bytes.fromhex(f"{0:024x}") +
                                  bytes.fromhex(hit[2:])))
        return out


def _spec(addresses):
    return PoolSpec.from_api({
        "address": "0x" + "a1" * 20, "name": "lending", "pool_type": "main",
        "coins": [{"address": a, "symbol": f"c{k}", "decimals": 18,
                   "pool_index": k} for k, a in enumerate(addresses)],
    })


REAL = ["0x" + f"{k:02x}" * 20 for k in range(1, 4)]
UNDERLYING = ["0x" + f"{k:02x}" * 20 for k in range(9, 11)]


def test_the_underlying_tail_is_dropped():
    spec = _spec(REAL + UNDERLYING)
    spec.balances = (10, 20, 30, 0, 0)
    assert spec.n_coins == 5, "the listing over-reports; that is the premise"

    notes = resolve_coin_counts([spec], Pool(REAL))
    assert spec.n_coins == 3
    assert [c.address.lower() for c in spec.coins] == REAL
    assert spec.balances == (10, 20, 30), "balances must be cut to match N"
    assert notes and "dropped the underlying view" in notes[0]


def test_the_int128_spelling_is_not_read_as_no_coins():
    """The older lending pools index with int128 and revert on every
    `coins(uint256)` -- which taken alone says the pool has no coins at all."""
    spec = _spec(REAL + UNDERLYING)
    notes = resolve_coin_counts([spec], Pool(REAL, spelling="coins(int128)"))
    assert spec.n_coins == 3, "int128 pools must not be truncated to nothing"
    assert notes


def test_a_pool_that_will_not_answer_keeps_its_listing():
    """Silence is not evidence the listing is wrong, and shrinking on it would
    delete real coins -- the failure this whole check exists to avoid."""
    spec = _spec(REAL)
    notes = resolve_coin_counts([spec], Pool([]))
    assert spec.n_coins == 3
    assert notes == []


def test_an_agreeing_pool_is_left_alone():
    spec = _spec(REAL)
    before = spec.coins
    assert resolve_coin_counts([spec], Pool(REAL)) == []
    assert spec.coins is before


def test_a_pool_reporting_more_than_the_listing_is_reported_not_grown():
    """Never seen on any chain, and the one failure a shrink-only check cannot
    detect by itself -- so it is said out loud rather than acted on."""
    spec = _spec(REAL)
    notes = resolve_coin_counts([spec], Pool(REAL + UNDERLYING))
    assert spec.n_coins == 3, "the listing is kept; growing N silently is worse"
    assert notes and "kept the listing" in notes[0]
