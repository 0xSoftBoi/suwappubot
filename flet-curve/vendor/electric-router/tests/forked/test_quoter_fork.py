"""The quoter against real mainnet pools.

Every assertion compares the quoter's answer to a plain `eth_call` at the *same
pinned block*, so these hold at any block and need no archive node.
"""

from __future__ import annotations

from itertools import pairwise

import pytest

from erouter.core.codec import decode_uint, encode_call
from erouter.core.transport import Status
from erouter.core.types import ArcKind, Leg, Probe

pytestmark = pytest.mark.forked

ONE = 10**18

# 3pool: the most stable reference point on Ethereum.  StableSwap dialect
# (int128), coins DAI(18) / USDC(6) / USDT(6).
THREEPOOL = "0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7"

# "Curve.fi USD-BTC-ETH" -- USDT(6)/WBTC(8)/WETH(18).  Two live traps in one
# pool: the Curve API types it `main` (which classifies as StableSwap) but it
# only answers the *crypto* spelling, and the wrong spelling returns EMPTY DATA
# rather than reverting.  Pinned as a regression.
MISTYPED_CRYPTO = "0x80466c64868E1ab14a1Ddf27A676C3fcBE638Fe5"


def direct_get_dy(rpc, pool, i, j, dx, *, stable=True):
    sig = (
        "get_dy(int128,int128,uint256)"
        if stable
        else "get_dy(uint256,uint256,uint256)"
    )
    return decode_uint(rpc.call(pool, encode_call(sig, i, j, dx)))


def test_quoter_matches_a_direct_eth_call(rpc, quoter_client):
    """The milestone: injected bytecode gives the same number as the pool."""
    dx = 1000 * ONE
    expected = direct_get_dy(rpc, THREEPOOL, 0, 1, dx)
    got = quoter_client.probe([Probe(THREEPOOL, ArcKind.SWAP_STABLE, 0, 1, 2, dx)])

    assert got[0].status is Status.VALUE
    assert got[0].value == expected  # wei-exact, not approximately
    assert 900 * 10**6 < expected < 1100 * 10**6  # ~1000 USDC, 6 decimals


def test_wrong_dialect_reverts_on_some_pools(rpc, quoter_client):
    """3pool implements only int128; the crypto spelling reverts outright."""
    got = quoter_client.probe([
        Probe(THREEPOOL, ArcKind.SWAP_STABLE, 0, 1, 3, ONE),
        Probe(THREEPOOL, ArcKind.SWAP_CRYPTO, 0, 1, 3, ONE),
    ])
    assert got[0].status is Status.VALUE and got[0].value > 0
    assert got[1].status is Status.REVERTED


def test_wrong_dialect_returns_empty_data_on_others(rpc, quoter_client):
    """The silent-zero trap, on a live pool -- and the API mis-types this one.

    `Curve.fi USD-BTC-ETH` is typed `main`, which the registry table classifies
    as StableSwap.  Sending int128 succeeds and returns *empty data*; decoding
    that as a uint gives 0, so the arc would look like a pool quoting zero
    rather than a dispatch bug.  60 Ethereum pools behave this way.
    """
    dx = 1000 * 10**6  # 1000 USDT, 6 decimals
    got = quoter_client.probe([
        Probe(MISTYPED_CRYPTO, ArcKind.SWAP_STABLE, 0, 2, 3, dx),
        Probe(MISTYPED_CRYPTO, ArcKind.SWAP_CRYPTO, 0, 2, 3, dx),
    ])
    assert got[0].status is Status.WRONG_ABI  # succeeded, said nothing
    assert got[0].value == 0
    assert got[1].status is Status.VALUE and got[1].value > 0

    raw = rpc.call(
        MISTYPED_CRYPTO, encode_call("get_dy(int128,int128,uint256)", 0, 2, dx)
    )
    assert raw == b""  # confirmed at the transport level too

    # ... and the registry table would have sent exactly that call.
    from erouter.core.pools import PoolSpec
    from erouter.core.types import Dialect

    spec = PoolSpec(MISTYPED_CRYPTO, "USD-BTC-ETH", "main", ())
    assert spec.table_dialect is Dialect.STABLE  # wrong, hence probe-and-observe


def test_all_six_directions_of_threepool(rpc, quoter_client):
    pairs = [(i, j) for i in range(3) for j in range(3) if i != j]
    probes = [Probe(THREEPOOL, ArcKind.SWAP_STABLE, i, j, 3, ONE) for i, j in pairs]
    got = quoter_client.probe(probes)
    assert all(q.status is Status.VALUE and q.value > 0 for q in got)
    for (i, j), q in zip(pairs, got, strict=True):
        assert q.value == direct_get_dy(rpc, THREEPOOL, i, j, ONE)


def test_series_route_matches_a_hand_chained_quote(rpc, quoter_client):
    """DAI -> USDC -> USDT through 3pool, chained inside the contract.

    A plain multicall cannot express this: hop 2's input is hop 1's output.
    """
    dx = 10_000 * ONE
    mid = direct_get_dy(rpc, THREEPOOL, 0, 1, dx)
    expected = direct_get_dy(rpc, THREEPOOL, 1, 2, mid)

    got = quoter_client.quote_route(
        [
            Leg(THREEPOOL, ArcKind.SWAP_STABLE, i=0, j=1, n=3, src_slot=0, dst_slot=1),
            Leg(THREEPOOL, ArcKind.SWAP_STABLE, i=1, j=2, n=3, src_slot=1, dst_slot=2),
        ],
        dx,
        2,
    )
    assert got == expected


def test_parallel_split_matches_two_independent_quotes(rpc, quoter_client):
    """DAI -> USDC split 40/60 across two directions of the same pool.

    Note this is the *shared pool* case the design forbids per route; here it
    is deliberate, to show the quoter's arithmetic is exact even so (both legs
    read the same pre-trade state, which is precisely why the model must not
    rely on it).
    """
    dx = 1000 * ONE
    a = direct_get_dy(rpc, THREEPOOL, 0, 1, dx * 40 // 100)
    b = direct_get_dy(rpc, THREEPOOL, 0, 1, dx - dx * 40 // 100)

    got = quoter_client.quote_route(
        [
            Leg(THREEPOOL, ArcKind.SWAP_STABLE, i=0, j=1, n=3, src_slot=0, dst_slot=1, bps=4000),
            Leg(THREEPOOL, ArcKind.SWAP_STABLE, i=0, j=1, n=3, src_slot=0, dst_slot=1, bps=0),
        ],
        dx,
        1,
    )
    assert got == a + b


def test_many_candidates_in_one_round_trip(rpc, quoter_client):
    """20 candidates, one eth_call -- the reason the quoter exists."""
    dx = 1000 * ONE
    routes = []
    for k in range(20):
        share = 500 + k * 250  # 5% .. 52.5%
        routes.append([
            Leg(THREEPOOL, ArcKind.SWAP_STABLE, i=0, j=1, n=3,
                src_slot=0, dst_slot=1, bps=share),
            Leg(THREEPOOL, ArcKind.SWAP_STABLE, i=0, j=2, n=3,
                src_slot=0, dst_slot=2, bps=0),
        ])
    outs = quoter_client.quote_routes(routes, [dx] * 20, [1] * 20)
    assert len(outs) == 20
    assert all(v > 0 for v in outs)


def test_probe_ladder_is_monotone_and_concave(rpc, quoter_client):
    """The geometric grid on a real pool: more in, more out, at a worse rate.

    Concavity is the load-bearing assumption of the whole model (§2.1), so it
    is worth checking against a live pool rather than only a synthetic one.
    """
    reserve = decode_uint(rpc.call(THREEPOOL, encode_call("balances(uint256)", 0)))
    grid = [int(reserve * f) for f in (1e-6, 1e-4, 1e-3, 1e-2, 3e-2, 1e-1)]
    got = quoter_client.probe(
        [Probe(THREEPOOL, ArcKind.SWAP_STABLE, 0, 1, 3, dx) for dx in grid]
    )
    assert all(q.status is Status.VALUE for q in got)

    outs = [q.value for q in got]
    assert all(b > a for a, b in pairwise(outs))  # strictly increasing

    rates = [out / dx for out, dx in zip(outs, grid, strict=True)]
    assert all(b <= a * (1 + 1e-9) for a, b in pairwise(rates))  # concave


def test_raw_batch_resolves_the_balances_spelling(rpc, quoter_client):
    """`balances(uint256)` vs `balances(int128)` -- send both, take what answers."""
    from erouter.core.transport import Call

    got = quoter_client.raw([
        Call(THREEPOOL, encode_call("balances(uint256)", 0)),
        Call(THREEPOOL, encode_call("balances(int128)", 0)),
    ])
    answered = [g for g in got if g.status is Status.VALUE]
    assert answered, "3pool answered neither balances spelling"
    assert answered[0].uint() > 0


def test_override_and_fork_backends_agree(rpc, quoter_client):
    """What lets the CLI trust the fast path: same bytecode, same answer."""
    from erouter.dev.boa_host import fork_client

    probes = [
        Probe(THREEPOOL, ArcKind.SWAP_STABLE, 0, 1, 3, 1000 * ONE),
        Probe(THREEPOOL, ArcKind.SWAP_STABLE, 2, 0, 3, 1000 * 10**6),
    ]
    via_override = quoter_client.probe(probes)
    via_fork = fork_client(rpc.url, rpc.block).probe(probes)
    assert via_override == via_fork
