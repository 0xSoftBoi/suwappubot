"""End-to-end routing against mainnet, unverified (Phase 5).

The headline number here is *modelled*, not quoted: §7's on-chain verification
is what turns it into a quote.  So these assert the things that must hold of
the model itself -- conservation, merging, ordering, honest reporting -- and
compare against a real single-pool baseline where that is meaningful.
"""

from __future__ import annotations

import pytest

from erouter.chain.wrappers import build_node_map
from erouter.core.pipeline import RoutingError, route
from erouter.core.pools import parse_universe
from erouter.core.realize import check_one_arc_per_pool
from erouter.core.render_text import render
from erouter.core.rendermodel import build_diagram
from erouter.core.schema import to_json
from erouter.core.types import ArcKind, Probe
from erouter.dev.universe import read_balances, resolve_dialects

pytestmark = pytest.mark.forked

USDC = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"
WETH = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2"
ETH = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
CRVUSD = "0xf939e0a03fb07f59a73314e73794be0e57ac1b4e"
SCRVUSD = "0x0655977feb2f289a4ab78af67bab0d17aab84367"


@pytest.fixture(scope="module")
def universe(pools, quoter_client, chain):
    specs = parse_universe(pools)
    resolve_dialects(specs, quoter_client, chain)
    read_balances(specs, quoter_client)
    nodes, wrappers = build_node_map(specs, chain, quoter_client)
    return specs, nodes, wrappers


@pytest.fixture(scope="module")
def usdc_weth(universe, quoter_client):
    specs, nodes, _ = universe
    return route(
        specs, nodes, quoter_client,
        src_token=USDC, dst_token=WETH, amount_in=10_000 * 10**6,
    )


def test_a_route_is_found_and_conserves_flow(usdc_weth):
    result = usdc_weth
    assert result.ok
    assert result.route.modelled_out > 0
    # everything leaving the source adds up to the input
    from_source = [
        leg for leg in result.route.legs if leg.leg.src_slot == 0
    ]
    assert sum(leg.amount_in for leg in from_source) == result.amount_in


def test_legs_are_topologically_ordered(usdc_weth):
    """Each leg's input must already exist when it runs."""
    filled = {0}
    for realized in usdc_weth.route.legs:
        assert realized.leg.src_slot in filled, "leg draws from an unfilled slot"
        filled.add(realized.leg.dst_slot)


def test_bps_groups_are_contiguous_and_end_with_a_sweep(usdc_weth):
    """`bps` is a share of the balance snapshotted when a group opens.

    The contract re-snapshots on *every* change of `src_slot`, so a slot being
    drained again later is not by itself wrong -- the second group measures
    against whatever is there by then.  What would be wrong is a group whose
    `bps` were computed against the node's whole arrival but which opens on a
    partly drained slot, and that can only happen to a group carrying `bps`.

    A pure sweep is immune: `bps == 0` takes `bal[src]`, not `base`.  A node that
    both receives and sends a non-canonical token legitimately produces exactly
    that shape, so requiring outright adjacency failed on correct routes.
    """
    legs = usdc_weth.route.legs
    groups: list[list] = []
    for realized in legs:
        if groups and groups[-1][0].leg.src_slot == realized.leg.src_slot:
            groups[-1].append(realized)
        else:
            groups.append([realized])
    seen = set()
    for group in groups:
        slot = group[0].leg.src_slot
        if slot in seen:
            assert all(leg.leg.bps == 0 for leg in group), (
                f"slot {slot} is drained again by a group carrying bps; those "
                "shares were measured against a balance that is already gone"
            )
        seen.add(slot)
        assert group[-1].leg.bps == 0, "last leg out of a node must sweep"
        assert all(leg.leg.bps > 0 for leg in group[:-1])


def test_the_route_beats_the_best_single_pool(universe, quoter_client, usdc_weth):
    """Splitting has to be worth something, or the whole design is pointless."""
    specs, _nodes, _ = universe
    amount = 10_000 * 10**6
    direct = [
        (p, {c.address.lower(): k for k, c in enumerate(p.coins)})
        for p in specs
        if p.swap_kind is not None
    ]
    probes, meta = [], []
    for pool, index in direct:
        if USDC in index and WETH in index:
            probes.append(
                Probe(pool.address, pool.swap_kind, index[USDC], index[WETH],
                      pool.n_coins, amount)
            )
            meta.append(pool)
    if not probes:
        pytest.skip("no pool holds both USDC and WETH")
    best = max((q.value for q in quoter_client.probe(probes) if q.ok), default=0)
    assert best > 0

    # Assert on the figure we ship.  `modelled_out` is a *lower bound* by
    # construction (§3.6 -- the quadratic majorant over-states loss), so
    # comparing it to a real quote tests the model's tightness, not the route:
    # merging wstETH into stETH moved the reference-price fit enough to drop
    # the modelled figure 10% while the verified output rose slightly.
    verified = usdc_weth.verified_out or 0
    assert verified >= best * 0.999, (
        f"split route {verified} < best single pool {best} "
        f"({(verified / best - 1) * 1e4:+.2f} bp)"
    )
    # ...and the model must stay on the conservative side of reality.
    assert usdc_weth.route.modelled_out <= verified * 1.001, (
        "modelled output exceeds the verified quote; the majorant is inverted"
    )


def test_native_eth_destination_emits_an_unwrap(universe, quoter_client):
    """The WETH/ETH merge, end to end."""
    specs, nodes, _ = universe
    assert nodes.node(ETH) == nodes.node(WETH)
    result = route(
        specs, nodes, quoter_client,
        src_token=USDC, dst_token=ETH, amount_in=10_000 * 10**6,
    )
    last = result.route.legs[-1]
    assert last.kind is ArcKind.UNWRAP_NATIVE
    assert last.amount_out == last.amount_in  # 1:1, no loss crossing the node


def test_scrvusd_is_merged_into_crvusd(universe):
    _specs, nodes, wrappers = universe
    if not nodes.has(SCRVUSD):
        pytest.skip("scrvUSD is not in the universe at this TVL floor")
    assert nodes.node(SCRVUSD) == nodes.node(CRVUSD)
    assert nodes.canonical(SCRVUSD) == CRVUSD
    merged = {v.token for v in wrappers.merged_vaults}
    assert SCRVUSD in merged


def test_routing_between_merged_tokens_converts(universe, quoter_client):
    """They are one node, so the merge itself is the route.

    This used to be refused outright -- two addresses on one node have no arc
    between them.  `7a02663` changed the contract: a merged pair quotes the
    conversion instead, because "there is no arc" is a statement about the graph
    and not an answer to the question the caller asked.

    What is worth pinning is the shape of the answer: one leg, the vault's own
    `previewDeposit`, and a rate that is the vault's rather than 1:1 -- scrvUSD
    is worth more than crvUSD, so a route returning the input unchanged would
    mean the merge had quietly become an alias.
    """
    specs, nodes, _ = universe
    if not nodes.has(SCRVUSD):
        pytest.skip("scrvUSD is not in the universe")
    result = route(specs, nodes, quoter_client,
                   src_token=CRVUSD, dst_token=SCRVUSD, amount_in=10**21)

    assert result.ok and result.verified_out > 0
    assert result.counters.get("conversion_only") == 1
    assert len(result.route.legs) == 1
    assert result.route.legs[0].kind is ArcKind.ERC4626_DEPOSIT
    assert result.verified_out < 10**21, (
        "scrvUSD is worth more than crvUSD, so a deposit must return fewer "
        f"shares than assets; got {result.verified_out} for {10**21}")


def test_unreachable_destination_reports_rather_than_crashes(universe, quoter_client):
    specs, nodes, _ = universe
    fake = "0x" + "dd" * 20
    nodes.add_token(fake, "NOPE", 18)
    with pytest.raises(RoutingError):
        route(specs, nodes, quoter_client,
              src_token=USDC, dst_token=fake, amount_in=10**6)


def test_one_arc_per_pool_is_reported_when_violated(usdc_weth):
    """Not yet enforced -- conflict repair lands with candidates -- but it must
    never be silent, because a view-only quote cannot see its own earlier leg."""
    conflicts = check_one_arc_per_pool(usdc_weth.route)
    if conflicts:
        assert any("more than once" in w for w in usdc_weth.warnings)


def test_certificate_is_reported_with_a_reason(usdc_weth):
    """§15: it must be surfaced, not swallowed."""
    if usdc_weth.certificate:
        assert usdc_weth.certificate_reason is None
    else:
        assert usdc_weth.certificate_reason


def test_json_and_diagram_render(usdc_weth, universe):
    _, nodes, _ = universe
    payload = to_json(usdc_weth, chain="ethereum", chain_id=1, block=0)
    assert payload["result"]["certificate"] in (True, False)
    if not payload["result"]["certificate"]:
        assert payload["result"]["certificate_reason"]
    assert int(payload["result"]["amount_out"]) > 0
    assert len(payload["legs"]) == len(usdc_weth.route.legs)
    # amounts are integer strings in native units
    for leg in payload["legs"]:
        assert leg["amount_in"].lstrip("-").isdigit()

    text = render(build_diagram(usdc_weth.route, nodes), color=False)
    assert "▷|" in text
