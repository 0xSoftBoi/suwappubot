"""Curve's pool_filters list, applied to a cached universe.

Today `/v2/pools` already excludes every flagged pool, so the filter drops
nothing on a fresh load -- measured at min_tvl=0: 2,211 pools returned, 0
flagged among them.  The case it exists for is the *cached* one: our universe
cache can serve a snapshot taken before a pool was flagged, and Curve's list
moves on Curve's schedule, not ours.  So the filter runs on the cache and
stale paths too, and that is what these tests pin.
"""

from __future__ import annotations

from erouter.dev.universe import _apply_filters


class FakeApi:
    def __init__(self, blocked: set[str]) -> None:
        self.blocked = blocked
        self.calls = 0

    def pool_filters(self, chain_id: int) -> set[str]:
        self.calls += 1
        return self.blocked


class FakeChain:
    chain_id = 1


class FakePool:
    def __init__(self, address: str) -> None:
        self.address = address


def test_flagged_pools_are_dropped():
    pools = [FakePool("0xAAA"), FakePool("0xBbB"), FakePool("0xCCC")]
    warnings: list[str] = []
    kept, dropped = _apply_filters(pools, FakeChain(), FakeApi({"0xbbb"}), warnings, enabled=True)

    assert dropped == 1
    assert [p.address for p in kept] == ["0xAAA", "0xCCC"]
    assert warnings and "pool_filters" in warnings[0]


def test_matching_is_case_insensitive():
    """The API returns checksummed addresses; our specs are mixed case."""
    pools = [FakePool("0xDeAdBeEf"), FakePool("0xFEED")]
    kept, dropped = _apply_filters(pools, FakeChain(), FakeApi({"0xdeadbeef"}), [], enabled=True)
    assert dropped == 1
    assert [p.address for p in kept] == ["0xFEED"]


def test_it_is_off_by_default():
    """Measured against the live API it drops nothing -- /v2/pools already
    excludes every flagged pool -- so nobody should pay an HTTP round trip for
    it unless they want the cache-staleness protection."""
    api = FakeApi({"0xaaa"})
    pools = [FakePool("0xAAA"), FakePool("0xBBB")]
    kept, dropped = _apply_filters(pools, FakeChain(), api, [])

    assert dropped == 0
    assert len(kept) == 2
    assert api.calls == 0, "the filter list must not be fetched when disabled"


def test_an_unreachable_filter_list_does_not_empty_the_universe():
    """Routing unfiltered is worse than routing filtered, and far better than
    not routing.  Every quote is verified on-chain regardless."""
    pools = [FakePool("0xAAA"), FakePool("0xBBB")]
    warnings: list[str] = []
    kept, dropped = _apply_filters(pools, FakeChain(), FakeApi(set()), warnings, enabled=True)

    assert dropped == 0
    assert len(kept) == 2
    assert not warnings


# --------------------------------------------------- currency pairs


def _pool(key, *coins):
    from erouter.core.pools import Coin, PoolSpec

    return PoolSpec(
        address="0x" + "11" * 20, name="p", pool_type=key,
        coins=tuple(Coin(address=a, symbol=s, decimals=18, index=k)
                    for k, (a, s) in enumerate(coins)))


def test_a_currency_pair_is_not_volatile_however_the_pool_computes():
    """gnosis trades USDC.e against EURe in a twocrypto pool.  The invariant is
    the cryptoswap one; the pair is still two national currencies."""
    from erouter.core.pools import volatile_pools

    usdc, eure = "0x" + "aa" * 20, "0x" + "bb" * 20
    pool = _pool("twocryptong", (usdc, "USDC.e"), (eure, "EURe"))
    assert volatile_pools([pool]) == {pool.address.lower()}
    assert volatile_pools([pool], [usdc, eure]) == set()


def test_one_pegged_coin_is_not_enough():
    """USDC against ETH is a volatile pair with a stable on one side."""
    from erouter.core.pools import volatile_pools

    usdc, weth = "0x" + "aa" * 20, "0x" + "cc" * 20
    pool = _pool("twocryptong", (usdc, "USDC"), (weth, "WETH"))
    assert volatile_pools([pool], [usdc]) == {pool.address.lower()}


def test_a_stableswap_was_never_volatile_to_begin_with():
    from erouter.core.pools import volatile_pools

    pool = _pool("stableswapng", ("0x" + "aa" * 20, "USDC"), ("0x" + "dd" * 20, "USDT"))
    assert volatile_pools([pool]) == set()


def test_the_declared_currencies_are_real_addresses():
    """A typo here silently loosens a bound rather than failing."""
    from erouter.chain.chains import CHAINS

    seen = 0
    for name, chain in CHAINS.items():
        for token in chain.forex:
            assert token.startswith("0x") and len(token) == 42, f"{name}: {token}"
            seen += 1
        # A currency token must not also be claimed as a dollar.
        overlap = {t.lower() for t in chain.forex} & {t.lower() for t in chain.stables}
        assert not overlap, f"{name}: {overlap} is listed as both"
    assert seen > 10, "the currency list went missing"
