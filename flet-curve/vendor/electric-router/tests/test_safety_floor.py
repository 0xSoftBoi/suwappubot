"""The direct-swap floor and the probe cache.

The floor exists because of a real failure: on a run where many probes timed
out, only 276 of 766 arcs calibrated, no good path survived, and the router
returned **13,700 USDC for 100,000 DAI** -- and verified it honestly, because
every candidate it generated really was that bad.

A router must never be beaten by a swap anyone could find by inspection, and
the way to guarantee that is a candidate that does not depend on the probe
grid, the calibration, the price fit or the solver.
"""

from __future__ import annotations

import numpy as np

from erouter.core.nodes import Conversion, ConversionKind, NodeMap
from erouter.core.pipeline import direct_candidates
from erouter.core.pools import Coin, PoolSpec
from erouter.core.types import ArcKind, Dialect

USDC = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"
USDT = "0xdac17f958d2ee523a2206206994597c13d831ec7"
DAI = "0x6b175474e89094c44da98b954eedeac495271d0f"
WETH = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2"
ETH = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"


def pool(address, coins, dialect=Dialect.STABLE, name="pool"):
    spec = PoolSpec(
        address=address, name=name, pool_type="main",
        coins=tuple(Coin(a, s, d, k) for k, (a, s, d) in enumerate(coins)),
        tvl_usd=1e6,
    )
    spec.dialect = dialect
    spec.balances = tuple(10**18 for _ in coins)
    return spec


def nodes_for(pools, merge_eth=False):
    nodes = NodeMap()
    for spec in pools:
        for coin in spec.coins:
            nodes.add_token(coin.address, coin.symbol, coin.decimals)
    if merge_eth:
        nodes.add_token(WETH, "WETH", 18)
        nodes.merge(Conversion(ConversionKind.NATIVE_WRAP, ETH, WETH, 1, 1, target=WETH))
    return nodes


def test_one_candidate_per_pool_holding_both_tokens():
    pools = [
        pool("0x" + "11" * 20, [(DAI, "DAI", 18), (USDC, "USDC", 6), (USDT, "USDT", 6)]),
        pool("0x" + "22" * 20, [(DAI, "DAI", 18), (USDC, "USDC", 6)]),
        pool("0x" + "33" * 20, [(USDT, "USDT", 6), (WETH, "WETH", 18)]),  # irrelevant
    ]
    nodes = nodes_for(pools)
    nu = np.ones(nodes.n_nodes)

    candidates, arcs = direct_candidates(pools, nodes, nu, DAI, USDC, 10**18)
    assert len(candidates) == len(arcs) == 2
    assert {a.pool for a in arcs} == {"0x" + "11" * 20, "0x" + "22" * 20}
    for arc in arcs:
        assert arc.token_in.lower() == DAI
        assert arc.token_out.lower() == USDC
        assert arc.i != arc.j
    assert all(c.kind == "direct" for c in candidates)


def test_the_floor_does_not_depend_on_calibration():
    """No probe, no ladder, no `a`/`B` fit -- that is the entire point."""
    pools = [pool("0x" + "11" * 20, [(DAI, "DAI", 18), (USDC, "USDC", 6)])]
    nodes = nodes_for(pools)
    _, arcs = direct_candidates(pools, nodes, np.ones(nodes.n_nodes), DAI, USDC, 10**18)
    assert arcs[0].B == 0.0  # never fitted
    assert arcs[0].kind is ArcKind.SWAP_STABLE  # dialect still respected


def test_merged_tokens_are_matched_through_their_node():
    """A pool holding native ETH still counts as a direct WETH route."""
    pools = [pool("0x" + "44" * 20, [(USDC, "USDC", 6), (ETH, "ETH", 18)])]
    nodes = nodes_for(pools, merge_eth=True)
    candidates, arcs = direct_candidates(
        pools, nodes, np.ones(nodes.n_nodes), USDC, WETH, 10**6
    )
    assert len(candidates) == 1
    assert arcs[0].token_out.lower() == ETH  # the pool's own token
    assert arcs[0].sigma == nodes.node(WETH)  # but the graph node is shared


def test_no_direct_pool_means_no_floor_not_an_error():
    pools = [pool("0x" + "11" * 20, [(DAI, "DAI", 18), (USDC, "USDC", 6)])]
    nodes = nodes_for(pools)
    nodes.add_token(WETH, "WETH", 18)
    candidates, arcs = direct_candidates(
        pools, nodes, np.ones(nodes.n_nodes), DAI, WETH, 10**18
    )
    assert candidates == [] and arcs == []


def test_a_pool_with_the_pair_in_both_directions_yields_one_arc_each_way():
    pools = [pool("0x" + "11" * 20, [(DAI, "DAI", 18), (USDC, "USDC", 6)])]
    nodes = nodes_for(pools)
    nu = np.ones(nodes.n_nodes)
    forward, _ = direct_candidates(pools, nodes, nu, DAI, USDC, 10**18)
    reverse, _ = direct_candidates(pools, nodes, nu, USDC, DAI, 10**6)
    assert len(forward) == len(reverse) == 1


# ------------------------------------------------------------- probe cache


def test_probe_cache_round_trips(tmp_path):
    from erouter.chain.cache import Cache
    from erouter.chain.probe_cache import CachedQuoterClient
    from erouter.core.transport import Status
    from erouter.core.types import Probe

    class Counter:
        def __init__(self):
            self.calls = 0

        def probe(self, probes):
            from erouter.core.quoter import Quote

            self.calls += 1
            return [Quote(Status.VALUE, 100 + k) for k in range(len(probes))]

    inner = Counter()
    client = CachedQuoterClient(inner, 1, 123, cache=Cache(tmp_path))
    probes = [Probe("0x" + "11" * 20, ArcKind.SWAP_STABLE, 0, 1, 2, 10**18)]

    first = client.probe(probes)
    second = client.probe(probes)
    assert inner.calls == 1  # the second is served from disk
    assert [q.value for q in first] == [q.value for q in second]
    assert [q.status for q in first] == [q.status for q in second]
    assert client.stats.hits == 1 and client.stats.misses == 1


def test_probe_cache_is_keyed_by_block_and_by_batch(tmp_path):
    from erouter.chain.cache import Cache
    from erouter.chain.probe_cache import CachedQuoterClient, digest
    from erouter.core.quoter import Quote
    from erouter.core.transport import Status
    from erouter.core.types import Probe

    class Counter:
        def __init__(self):
            self.calls = 0

        def probe(self, probes):
            self.calls += 1
            return [Quote(Status.VALUE, 1) for _ in probes]

    inner = Counter()
    cache = Cache(tmp_path)
    probes = [Probe("0x" + "11" * 20, ArcKind.SWAP_STABLE, 0, 1, 2, 10**18)]
    other = [Probe("0x" + "11" * 20, ArcKind.SWAP_STABLE, 0, 1, 2, 2 * 10**18)]

    assert digest(probes) != digest(other)  # size is part of the key

    CachedQuoterClient(inner, 1, 100, cache=cache).probe(probes)
    CachedQuoterClient(inner, 1, 101, cache=cache).probe(probes)  # a new block
    assert inner.calls == 2

    CachedQuoterClient(inner, 1, 100, cache=cache).probe(probes)  # hit
    assert inner.calls == 2


# --------------------------------------------------- the two-hop half of it

CRVUSD = "0xf939e0a03fb07f59a73314e73794be0e57ac1b4e"
SUSDE = "0x9d39a5de30e57443bff2a8307a4256c8797a3497"
#: Enough distinct dead ends to overrun the `3 * limit` cut round A takes.
CHEAP = [f"0x{0xcd00 + k:040x}" for k in range(24)]


class _Quoter:
    """Swaps at 1:1 in whole tokens, with a per-pool multiplier on the units out.

    Decimals are honoured, because the bug under test is precisely a confusion
    between a token *count* and a value: a pool whose coin trades at a millionth
    of a dollar pays out a millionfold more units for the same money, and it is
    that number the ranking used to sort on.
    """

    def __init__(self, pools, units_out: dict[str, tuple[int, int]] | None = None):
        self.decimals = {p.address.lower(): [c.decimals for c in p.coins]
                         for p in pools}
        #: `(numerator, denominator)` on the units out, so a pool that pays a
        #: millionfold has a partner that takes a millionfold back -- otherwise
        #: the dust would really be worth more and the test would be wrong.
        self.units_out = {k.lower(): v for k, v in (units_out or {}).items()}
        self.probes = 0

    def probe(self, probes):
        from erouter.core.quoter import Quote, Status

        self.probes += len(probes)
        out = []
        for probe in probes:
            dec = self.decimals[probe.pool.lower()]
            scaled = probe.dx * 10 ** dec[probe.j] // 10 ** dec[probe.i]
            num, den = self.units_out.get(probe.pool.lower(), (1, 1))
            out.append(Quote(Status.VALUE, scaled * num // den))
        return out


def test_two_step_finds_the_middle_that_can_actually_reach_the_destination():
    """Reachability decides who is probed, not who quotes the largest number.

    Round A used to keep the best `3 * limit` middles by output and only then
    ask where they could go.  Output is a token count, so a token trading at a
    fraction of a cent sorts above every stable by being numerous -- measured on
    USDC -> sUSDe at $1,000 the list ran CXD at 2,513,355 units, then HLX, FIDU,
    STG, and the only three middles that could reach sUSDe were all cut.  The
    two-hop floor came back empty for a pair with an obvious two-hop route.
    """
    from erouter.core.pipeline import two_step_candidates

    # Many cheap dead ends off USDC, and one real bridge through crvUSD.
    dead_ends = [pool(f"0x{k:040x}", [(USDC, "USDC", 6), (CHEAP[k], f"CHEAP{k}", 18)],
                      name=f"dead{k}") for k in range(len(CHEAP))]
    bridge = pool("0x" + "b1" * 20, [(USDC, "USDC", 6), (CRVUSD, "crvUSD", 18)],
                  name="USDC/crvUSD")
    exit_ = pool("0x" + "e1" * 20, [(CRVUSD, "crvUSD", 18), (SUSDE, "sUSDe", 18)],
                 name="sUSDe/crvUSD")
    pools = [*dead_ends, bridge, exit_]
    nodes = nodes_for(pools)
    nu = np.ones(len(nodes.canonical_of) + 40)
    # The dead ends pay a millionfold in units; the bridge pays 1:1.
    quoter = _Quoter(pools, {p.address: (1_000_000, 1) for p in dead_ends})

    out, chains = two_step_candidates(
        pools, nodes, nu, quoter, USDC, SUSDE, 1000 * 10**6)

    assert out, "the only two-hop route in the universe was not offered"
    assert len(chains[0]) == 2
    used = {arc.pool.lower() for arc in chains[0]}
    assert used == {bridge.address.lower(), exit_.address.lower()}


def test_two_step_does_not_probe_middles_that_lead_nowhere():
    """Intersecting first is cheaper, not just righter."""
    from erouter.core.pipeline import two_step_candidates

    dead_ends = [pool(f"0x{k:040x}", [(USDC, "USDC", 6), (CHEAP[k], f"CHEAP{k}", 18)],
                      name=f"dead{k}") for k in range(len(CHEAP))]
    bridge = pool("0x" + "b1" * 20, [(USDC, "USDC", 6), (CRVUSD, "crvUSD", 18)])
    exit_ = pool("0x" + "e1" * 20, [(CRVUSD, "crvUSD", 18), (SUSDE, "sUSDe", 18)])
    pools = [*dead_ends, bridge, exit_]
    quoter = _Quoter(pools)
    two_step_candidates(pools, nodes_for(pools), np.ones(64), quoter,
                        USDC, SUSDE, 1000 * 10**6)
    # One probe out of USDC through the bridge, one on through the exit.  The
    # dead ends are known to be dead without asking the chain at all.
    assert quoter.probes == 2, f"probed {quoter.probes}, expected 2"


def test_two_step_is_empty_when_nothing_bridges_the_pair():
    from erouter.core.pipeline import two_step_candidates

    pools = [pool("0x" + "b1" * 20, [(USDC, "USDC", 6), (CRVUSD, "crvUSD", 18)]),
             pool("0x" + "d1" * 20, [(DAI, "DAI", 18), (SUSDE, "sUSDe", 18)])]
    out, chains = two_step_candidates(pools, nodes_for(pools), np.ones(16),
                                      _Quoter(pools), USDC, SUSDE, 1000 * 10**6)
    assert out == [] and chains == []


def test_two_step_ranks_middles_by_value_not_by_token_count():
    """`nu` is what makes quantities in different tokens comparable.

    When more middles reach the destination than the cut keeps, the ones kept
    have to be the ones worth most -- not the ones that happen to be numerous.
    A token trading at a millionth of a dollar wins any comparison of raw
    `to_canonical_wei` by arithmetic alone.
    """
    from erouter.core.pipeline import two_step_candidates

    # Five middles all reach sUSDe; four are dust that pays out a millionfold.
    middles = [(CRVUSD, "crvUSD"), *[(CHEAP[k], f"CHEAP{k}") for k in range(4)]]
    pools = []
    for addr, name in middles:
        pools.append(pool(f"0xaa{addr[-38:]}", [(USDC, "USDC", 6), (addr, name, 18)],
                          name=f"USDC/{name}"))
        pools.append(pool(f"0xbb{addr[-38:]}", [(addr, name, 18), (SUSDE, "sUSDe", 18)],
                          name=f"{name}/sUSDe"))
    nodes = nodes_for(pools)
    # Into dust: a millionfold units.  Back out of it: a millionth, so the
    # round trip is worth what it started as and only the *count* is inflated.
    quoter = _Quoter(pools, {p.address: ((1_000_000, 1) if (p.name or "").startswith("USDC/")
                                         else (1, 1_000_000))
                             for p in pools if "CHEAP" in (p.name or "")})
    nu = np.ones(len(nodes.canonical_of) + 8)
    for addr, _ in middles[1:]:
        nu[nodes.node(addr)] = 1e-7           # dust: many units, little value

    # `3 * limit` = 3 keeps fewer than the five that reach, so the cut binds.
    out, chains = two_step_candidates(pools, nodes, nu, quoter, USDC, SUSDE,
                                      1000 * 10**6, limit=1)
    assert out, "no chain survived the cut"
    kept = {arc.token_in.lower() for chain in chains for arc in chain}
    assert CRVUSD.lower() in kept, "the valuable middle was cut for numerous ones"
