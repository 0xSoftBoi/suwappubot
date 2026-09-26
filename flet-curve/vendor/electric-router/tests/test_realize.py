"""Node merging and leg realisation -- no chain."""

from __future__ import annotations

from dataclasses import replace

import numpy as np
import pytest

from erouter.core.nodes import Conversion, ConversionKind, NodeMap, rescale
from erouter.core.realize import (
    RealizationError,
    check_one_arc_per_pool,
    realize,
    topological_nodes,
)
from erouter.core.types import ArcKind, PoolArc

ETH = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
WETH = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2"
USDC = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"
CRVUSD = "0xf939e0a03fb07f59a73314e73794be0e57ac1b4e"
SCRVUSD = "0x0655977feb2f289a4ab78af67bab0d17aab84367"

POOL_A = "0x" + "a1" * 20
LP_TOKEN = "0x" + "1b" * 20
POOL_B = "0x" + "b2" * 20
POOL_C = "0x" + "c3" * 20


def base_nodes() -> NodeMap:
    nodes = NodeMap()
    nodes.add_token(WETH, "WETH", 18)
    nodes.add_token(USDC, "USDC", 6)
    nodes.add_token(CRVUSD, "crvUSD", 18)
    return nodes


def merged_nodes() -> NodeMap:
    nodes = base_nodes()
    nodes.add_token(ETH, "ETH", 18)
    nodes.merge(
        Conversion(ConversionKind.NATIVE_WRAP, ETH, WETH, 1, 1, target=WETH)
    )
    nodes.add_token(SCRVUSD, "scrvUSD", 18)
    nodes.merge(
        Conversion(ConversionKind.ERC4626, SCRVUSD, CRVUSD, 11 * 10**17, 10**18, target=SCRVUSD)
    )
    return nodes


def arc(pool, token_in, token_out, nodes, *, a=1.0, B=1e-9, i=0, j=1, reserve=10**24):
    return PoolArc(
        id=f"{pool}:{i}>{j}",
        pool=pool,
        kind=ArcKind.SWAP_STABLE,
        i=i,
        j=j,
        n_coins=2,
        token_in=token_in,
        token_out=token_out,
        tau=nodes.node(token_in),
        sigma=nodes.node(token_out),
        a=a,
        B=B,
        G=1.0 / max(B, 1e-30),
        eps=1.0 - a,
        reserve_in=reserve,
        decimals_in=nodes.decimals(token_in),
        decimals_out=nodes.decimals(token_out),
    )


# ------------------------------------------------------------- node merging


def test_eth_and_weth_become_one_node():
    """The eight sentinel pools are otherwise nearly disconnected."""
    nodes = merged_nodes()
    assert nodes.node(ETH) == nodes.node(WETH)
    assert nodes.canonical(ETH) == WETH  # most pools hold the wrapped token
    assert nodes.rate(ETH) == 1.0
    assert nodes.to_canonical_wei(ETH, 10**18) == 10**18
    assert "ETH" in nodes.node_symbol(nodes.node(WETH))


def test_erc4626_merge_carries_an_exact_integer_rate():
    nodes = merged_nodes()
    assert nodes.node(SCRVUSD) == nodes.node(CRVUSD)
    assert nodes.canonical(SCRVUSD) == CRVUSD
    assert nodes.rate(SCRVUSD) == pytest.approx(1.1)
    # exact integer arithmetic, not a float round trip
    assert nodes.to_canonical_wei(SCRVUSD, 10**18) == 11 * 10**17
    assert nodes.from_canonical_wei(SCRVUSD, 11 * 10**17) == 10**18


def test_unmerged_tokens_keep_their_own_node():
    nodes = merged_nodes()
    assert nodes.node(USDC) != nodes.node(WETH)
    assert nodes.rate(USDC) == 1.0
    assert nodes.merged_nodes() == sorted(
        {nodes.node(WETH), nodes.node(CRVUSD)}
    )


def test_rescale_squares_the_input_rate():
    """B has units of output per input squared, so R_in enters twice.

    Getting this wrong is silent: the arc still solves, just with a
    conductance off by the price ratio.
    """
    a, B = rescale(2.0, 3.0, rate_in=4.0, rate_out=5.0)
    assert a == pytest.approx(2.0 * 5.0 / 4.0)
    assert B == pytest.approx(3.0 * 5.0 / 16.0)
    with pytest.raises(ValueError):
        rescale(1.0, 1.0, rate_in=0.0, rate_out=1.0)


# ----------------------------------------------------------------- ordering


def test_cycle_in_the_active_arcs_is_rejected():
    tau = np.array([0, 1, 2])
    sig = np.array([1, 2, 0])
    with pytest.raises(RealizationError, match="cycle"):
        topological_nodes(tau, sig, 3)


def test_topological_order_puts_sources_first():
    order = topological_nodes(np.array([0, 1]), np.array([1, 2]), 3)
    assert order == [0, 1, 2]


# --------------------------------------------------------------- realising


def test_single_hop():
    nodes = base_nodes()
    arcs = [arc(POOL_A, USDC, WETH, nodes, a=1 / 4000.0)]
    nu = np.zeros(nodes.n_nodes)
    nu[nodes.node(USDC)] = 1.0
    nu[nodes.node(WETH)] = 4000.0

    route = realize(
        arcs, np.array([1000.0]), nu, nodes,
        src_token=USDC, dst_token=WETH, amount_in=1000 * 10**6,
    )
    assert len(route.legs) == 1
    leg = route.legs[0]
    assert leg.leg.src_slot == 0
    assert leg.leg.bps == 0  # the only leg out of the node sweeps everything
    assert leg.amount_in == 1000 * 10**6
    assert route.modelled_out > 0
    assert route.dst_slot == route.slots[WETH]


def test_series_two_hops_chain_amounts():
    nodes = base_nodes()
    arcs = [
        arc(POOL_A, USDC, CRVUSD, nodes, a=1.0),
        arc(POOL_B, CRVUSD, WETH, nodes, a=1 / 4000.0),
    ]
    nu = np.zeros(nodes.n_nodes)
    nu[nodes.node(USDC)] = 1.0
    nu[nodes.node(CRVUSD)] = 1.0
    nu[nodes.node(WETH)] = 4000.0

    route = realize(
        arcs, np.array([1000.0, 1000.0]), nu, nodes,
        src_token=USDC, dst_token=WETH, amount_in=1000 * 10**6,
    )
    assert [rl.target for rl in route.legs] == [POOL_A, POOL_B]
    assert route.legs[1].leg.src_slot == route.legs[0].leg.dst_slot
    assert route.legs[1].amount_in == route.legs[0].amount_out


def test_parallel_split_shares_sum_and_the_last_leg_sweeps():
    nodes = base_nodes()
    arcs = [
        arc(POOL_A, USDC, WETH, nodes, a=1 / 4000.0),
        arc(POOL_B, USDC, WETH, nodes, a=1 / 4001.0, i=0, j=1),
    ]
    nu = np.zeros(nodes.n_nodes)
    nu[nodes.node(USDC)] = 1.0
    nu[nodes.node(WETH)] = 4000.0

    route = realize(
        arcs, np.array([700.0, 300.0]), nu, nodes,
        src_token=USDC, dst_token=WETH, amount_in=1000 * 10**6,
    )
    assert len(route.legs) == 2
    assert route.legs[0].leg.bps == 7000
    assert route.legs[1].leg.bps == 0  # remainder, so no dust is stranded
    assert route.legs[0].amount_in + route.legs[1].amount_in == 1000 * 10**6


def test_mid_path_branch_produces_two_groups():
    """USDC splits, one branch goes through crvUSD, both land on WETH."""
    nodes = base_nodes()
    arcs = [
        arc(POOL_A, USDC, WETH, nodes, a=1 / 4000.0),
        arc(POOL_B, USDC, CRVUSD, nodes, a=1.0),
        arc(POOL_C, CRVUSD, WETH, nodes, a=1 / 4000.0),
    ]
    nu = np.zeros(nodes.n_nodes)
    nu[nodes.node(USDC)] = 1.0
    nu[nodes.node(CRVUSD)] = 1.0
    nu[nodes.node(WETH)] = 4000.0

    route = realize(
        arcs, np.array([600.0, 400.0, 400.0]), nu, nodes,
        src_token=USDC, dst_token=WETH, amount_in=1000 * 10**6,
    )
    assert len(route.legs) == 3
    # the two legs leaving USDC are contiguous, so the bps snapshot is stable
    assert route.legs[0].leg.src_slot == route.legs[1].leg.src_slot == 0
    assert route.legs[2].leg.src_slot == route.slots[CRVUSD]
    assert route.legs[0].leg.bps == 6000
    assert route.legs[1].leg.bps == 0


def test_a_pool_holding_native_eth_gets_a_conversion_leg():
    """The route arrives holding WETH but the pool wants the sentinel."""
    nodes = merged_nodes()
    arcs = [
        arc(POOL_A, USDC, WETH, nodes, a=1 / 4000.0),
        arc(POOL_B, ETH, CRVUSD, nodes, a=4000.0),
    ]
    nu = np.zeros(nodes.n_nodes)
    nu[nodes.node(USDC)] = 1.0
    nu[nodes.node(WETH)] = 4000.0
    nu[nodes.node(CRVUSD)] = 1.0

    route = realize(
        arcs, np.array([1000.0, 1000.0]), nu, nodes,
        src_token=USDC, dst_token=CRVUSD, amount_in=1000 * 10**6,
    )
    conversions = [rl for rl in route.legs if rl.is_conversion]
    assert len(conversions) == 1
    assert conversions[0].kind is ArcKind.UNWRAP_NATIVE
    assert conversions[0].token_in.lower() == WETH
    assert conversions[0].token_out.lower() == ETH
    # 1:1, so nothing is lost crossing the merged node
    assert conversions[0].amount_out == conversions[0].amount_in


def test_no_conversion_when_every_arc_uses_the_canonical_token():
    nodes = merged_nodes()
    arcs = [
        arc(POOL_A, USDC, WETH, nodes, a=1 / 4000.0),
        arc(POOL_B, WETH, CRVUSD, nodes, a=4000.0),
    ]
    nu = np.zeros(nodes.n_nodes)
    nu[nodes.node(USDC)] = 1.0
    nu[nodes.node(WETH)] = 4000.0
    nu[nodes.node(CRVUSD)] = 1.0
    route = realize(
        arcs, np.array([1000.0, 1000.0]), nu, nodes,
        src_token=USDC, dst_token=CRVUSD, amount_in=1000 * 10**6,
    )
    assert not any(rl.is_conversion for rl in route.legs)


def test_destination_conversion_is_emitted():
    """Asking for ETH when the graph ends on the WETH hub."""
    nodes = merged_nodes()
    arcs = [arc(POOL_A, USDC, WETH, nodes, a=1 / 4000.0)]
    nu = np.zeros(nodes.n_nodes)
    nu[nodes.node(USDC)] = 1.0
    nu[nodes.node(WETH)] = 4000.0

    route = realize(
        arcs, np.array([1000.0]), nu, nodes,
        src_token=USDC, dst_token=ETH, amount_in=1000 * 10**6,
    )
    assert route.legs[-1].kind is ArcKind.UNWRAP_NATIVE
    assert route.dst_slot == route.slots[ETH]
    assert route.modelled_out > 0


def test_erc4626_destination_applies_the_vault_rate():
    nodes = merged_nodes()
    arcs = [arc(POOL_A, USDC, CRVUSD, nodes, a=1.0)]
    nu = np.zeros(nodes.n_nodes)
    nu[nodes.node(USDC)] = 1.0
    nu[nodes.node(CRVUSD)] = 1.0

    route = realize(
        arcs, np.array([1100.0]), nu, nodes,
        src_token=USDC, dst_token=SCRVUSD, amount_in=1100 * 10**6,
    )
    deposit = route.legs[-1]
    assert deposit.kind is ArcKind.ERC4626_DEPOSIT
    # 1.1 assets per share, so shares out are assets / 1.1
    assert deposit.amount_out == pytest.approx(deposit.amount_in / 1.1, rel=1e-9)


def test_one_arc_per_pool_violation_is_detected():
    """Decision 3: a view-only quoter cannot see its own earlier leg."""
    nodes = base_nodes()
    arcs = [
        arc(POOL_A, USDC, CRVUSD, nodes, a=1.0, i=0, j=1),
        arc(POOL_A, CRVUSD, WETH, nodes, a=1 / 4000.0, i=1, j=2),
    ]
    nu = np.ones(nodes.n_nodes)
    nu[nodes.node(WETH)] = 4000.0
    route = realize(
        arcs, np.array([1000.0, 1000.0]), nu, nodes,
        src_token=USDC, dst_token=WETH, amount_in=1000 * 10**6,
    )
    assert check_one_arc_per_pool(route) == [POOL_A.lower()]


def test_a_deposit_and_a_swap_on_one_pool_conflict():
    """A deposit mutates the pool too, so decision 3 has to cover it.

    `add_liquidity` and `remove_liquidity_one_coin` change the balances every
    later quote is computed from, exactly as `exchange` does.  The rule keys on
    the pool and an LP leg targets the pool contract, so this holds without a
    special case -- the test is here because "without a special case" is the
    part that could quietly stop being true.
    """
    nodes = base_nodes()
    nodes.add_token(LP_TOKEN, "poolLP", 18)
    swap = arc(POOL_A, USDC, CRVUSD, nodes, a=1.0, i=0, j=1)
    deposit = arc(POOL_A, CRVUSD, LP_TOKEN, nodes, a=1.0, i=1, j=0)
    deposit.kind = ArcKind.DEPOSIT_FIXED
    nu = np.ones(nodes.n_nodes)
    route = realize(
        [swap, deposit], np.array([1000.0, 1000.0]), nu, nodes,
        src_token=USDC, dst_token=LP_TOKEN, amount_in=1000 * 10**6,
    )

    assert check_one_arc_per_pool(route) == [POOL_A.lower()]


def test_realize_rejects_an_empty_flow():
    with pytest.raises(RealizationError):
        realize([], np.array([]), np.ones(2), base_nodes(),
                src_token=USDC, dst_token=WETH, amount_in=1)


def test_a_route_ending_in_native_eth_wraps_at_the_destination():
    """The destination node had no outgoing arcs, so the hub fold was skipped.

    A pool that pays out the ETH sentinel then deposited into the ETH slot while
    the caller asked for WETH; the quoter read the WETH slot, found nothing, and
    the whole candidate came back "reverted".  On mainnet that silently removed
    both large ETH/stETH pools from stETH->WETH.
    """
    nodes = merged_nodes()
    arcs = [arc(POOL_A, USDC, ETH, nodes, a=1 / 1890.0)]
    nu = np.zeros(nodes.n_nodes)
    nu[nodes.node(USDC)] = 1.0
    nu[nodes.node(WETH)] = 1890.0

    route = realize(
        arcs, np.array([1000.0]), nu, nodes,
        src_token=USDC, dst_token=WETH, amount_in=1000 * 10**6,
    )
    assert [rl.kind for rl in route.legs] == [ArcKind.SWAP_STABLE, ArcKind.WRAP_NATIVE]
    wrap = route.legs[-1]
    assert wrap.token_in.lower() == ETH and wrap.token_out.lower() == WETH
    assert wrap.amount_out == wrap.amount_in  # 1:1
    assert route.dst_slot == route.slots[WETH]
    assert route.modelled_out > 0  # the quoter would have read 0 before


def test_an_intermediate_dead_end_still_emits_no_conversion():
    """Only the destination gets the fold; a node with no way out is not one."""
    nodes = merged_nodes()
    arcs = [
        arc(POOL_A, USDC, ETH, nodes, a=1 / 1890.0),
        arc(POOL_B, WETH, CRVUSD, nodes, a=1890.0),
    ]
    nu = np.zeros(nodes.n_nodes)
    nu[nodes.node(USDC)] = 1.0
    nu[nodes.node(WETH)] = 1890.0
    nu[nodes.node(CRVUSD)] = 1.0
    route = realize(
        arcs, np.array([1000.0, 1000.0]), nu, nodes,
        src_token=USDC, dst_token=CRVUSD, amount_in=1000 * 10**6,
    )
    # ETH -> WETH is needed because the second arc consumes WETH, not because
    # the node is the destination
    kinds = [rl.kind for rl in route.legs]
    assert ArcKind.WRAP_NATIVE in kinds
    assert kinds[-1] is ArcKind.SWAP_STABLE  # the route ends on a real swap


def test_arrival_in_the_destination_token_skips_the_hub_round_trip():
    """A leg that already pays `dst_token` must not fold to the hub and back.

    `realize` converts everything arriving at a merged node into the node's
    canonical token, then converts out to whatever the caller asked for -- right
    when they differ, pure waste when they do not.  On USDC->sUSDS, pools paying
    sUSDS directly produced a route ending `... REDEEM sUSDS->USDS, DEPOSIT
    USDS->sUSDS`: two legs and two lots of integer rounding to arrive where it
    already was.  The mirror of the ETH-sentinel bug below, where the fold was
    missing and had to be added.
    """
    import math

    nodes = NodeMap()
    nodes.add_token(USDC, "USDC", 6)
    nodes.add_token(CRVUSD, "crvUSD", 18)
    nodes.add_token(SCRVUSD, "scrvUSD", 18)
    nodes.merge(
        Conversion(
            kind=ConversionKind.ERC4626, token=SCRVUSD, canonical=CRVUSD,
            rate_num=2 * 10**18, rate_den=10**18, target=SCRVUSD,
        )
    )
    # One pool that pays the *share* token directly -- exactly the sUSDS shape.
    arc = PoolArc(
        id="p:0>1", pool=POOL_A, kind=ArcKind.SWAP_STABLE, i=0, j=1, n_coins=2,
        token_in=USDC, token_out=SCRVUSD,
        tau=nodes.node(USDC), sigma=nodes.node(SCRVUSD),
        a=1.0, B=0.0, cap=math.inf, decimals_in=6, decimals_out=18,
    )
    route = realize(
        [arc], np.array([1.0]), np.ones(nodes.n_nodes), nodes,
        src_token=USDC, dst_token=SCRVUSD, amount_in=10**6,
    )
    kinds = [leg.leg.kind for leg in route.legs]
    assert ArcKind.ERC4626_REDEEM not in kinds, (
        f"folded the destination token into the hub: {[k.name for k in kinds]}"
    )
    assert ArcKind.ERC4626_DEPOSIT not in kinds, (
        f"converted back out of an empty hub: {[k.name for k in kinds]}"
    )
    assert len(route.legs) == 1, [k.name for k in kinds]


def test_a_node_that_receives_and_sends_one_token_does_not_round_trip():
    """USDC->ETH then ETH->crvUSD must not wrap and immediately unwrap.

    The canonical token is an arbitrary label; what matters is which member the
    legs want.  Hubbing on WETH regardless emitted `ETH->WETH, WETH->ETH` between
    the two swaps -- two legs and two lots of rounding to end where it started,
    and the reason one slot ended up drained by two non-adjacent groups.
    """
    nodes = merged_nodes()
    arcs = [
        arc(POOL_A, USDC, ETH, nodes, a=1 / 4000.0),
        arc(POOL_B, ETH, CRVUSD, nodes, a=4000.0),
    ]
    nu = np.zeros(nodes.n_nodes)
    nu[nodes.node(USDC)] = 1.0
    nu[nodes.node(WETH)] = 4000.0
    nu[nodes.node(CRVUSD)] = 1.0
    route = realize(
        arcs, np.array([1000.0, 1000.0]), nu, nodes,
        src_token=USDC, dst_token=CRVUSD, amount_in=1000 * 10**6,
    )
    assert not any(rl.is_conversion for rl in route.legs), (
        "wrapped and unwrapped for nothing: " + ", ".join(r.kind.name for r in route.legs)
    )
    assert len(route.legs) == 2


def test_the_hub_still_converts_when_the_node_sends_the_canonical_token():
    """Arriving as ETH and leaving as WETH is a real conversion, not waste."""
    nodes = merged_nodes()
    arcs = [
        arc(POOL_A, USDC, ETH, nodes, a=1 / 4000.0),
        arc(POOL_B, WETH, CRVUSD, nodes, a=4000.0),
    ]
    nu = np.zeros(nodes.n_nodes)
    nu[nodes.node(USDC)] = 1.0
    nu[nodes.node(WETH)] = 4000.0
    nu[nodes.node(CRVUSD)] = 1.0
    route = realize(
        arcs, np.array([1000.0, 1000.0]), nu, nodes,
        src_token=USDC, dst_token=CRVUSD, amount_in=1000 * 10**6,
    )
    conversions = [rl for rl in route.legs if rl.is_conversion]
    assert len(conversions) == 1
    assert conversions[0].kind is ArcKind.WRAP_NATIVE


def test_a_mixed_node_still_funnels_through_one_slot():
    """When the node sends *both* members, the hub is what makes bps well defined.

    Only sweeps may re-drain a slot, which is what keeps the funnel honest --
    the contract re-snapshots per group, so the second draw measures what is
    actually there.
    """
    nodes = merged_nodes()
    arcs = [
        arc(POOL_A, USDC, ETH, nodes, a=1 / 4000.0),
        arc(POOL_B, ETH, CRVUSD, nodes, a=4000.0),
        arc(POOL_C, WETH, CRVUSD, nodes, a=4000.0),
    ]
    nu = np.zeros(nodes.n_nodes)
    nu[nodes.node(USDC)] = 1.0
    nu[nodes.node(WETH)] = 4000.0
    nu[nodes.node(CRVUSD)] = 1.0
    route = realize(
        arcs, np.array([1000.0, 600.0, 400.0]), nu, nodes,
        src_token=USDC, dst_token=CRVUSD, amount_in=1000 * 10**6,
    )
    groups: list[list] = []
    for rl in route.legs:
        if groups and groups[-1][0].leg.src_slot == rl.leg.src_slot:
            groups[-1].append(rl)
        else:
            groups.append([rl])
    seen = set()
    for group in groups:
        slot = group[0].leg.src_slot
        if slot in seen:
            assert all(rl.leg.bps == 0 for rl in group), "re-drained with a stale base"
        seen.add(slot)


# ------------------------------------------------------ aliases share a slot
#
# Gnosis has two EURe contracts over one balance, so `discover_aliases` merges
# them into one node and no conversion leg exists between them.  Giving them a
# slot each meant the legs delivered into one accumulator and the route read the
# other, so the quoter returned 0 and a working route was dropped as reverting.
# On WXDAI->EURe that silently threw away the entire USDC.e side of the market.

EURE_1 = "0x" + "e1" * 20
EURE_2 = "0x" + "e2" * 20


def alias_nodes() -> NodeMap:
    nodes = base_nodes()
    nodes.add_token(EURE_1, "EURe", 18)
    nodes.add_token(EURE_2, "EURe", 18)
    # The deeper side is canonical; the other folds into it.
    nodes.merge(Conversion(ConversionKind.ALIAS, EURE_2, EURE_1, target=EURE_2))
    return nodes


def _to_eure(dst: str):
    nodes = alias_nodes()
    arcs = [arc(POOL_A, USDC, dst, nodes, a=1.0)]
    nu = np.zeros(nodes.n_nodes)
    nu[nodes.node(USDC)] = 1.0
    nu[nodes.node(dst)] = 1.0
    return nodes, realize(arcs, np.array([1000.0]), nu, nodes,
                          src_token=USDC, dst_token=dst,
                          amount_in=1000 * 10**6)


def test_a_route_delivering_the_other_alias_still_lands_in_the_slot_read():
    """The bug: legs filled slot 3 while the route read slot 4."""
    _, route = _to_eure(EURE_2)
    assert route.dst_slot == route.legs[-1].leg.dst_slot


def test_both_alias_addresses_map_to_one_slot():
    _nodes, route = _to_eure(EURE_1)
    assert route.slots.get(EURE_2.lower()) is None or (
        route.slots[EURE_2.lower()] == route.slots[EURE_1.lower()])
    assert len(set(route.slots.values())) == len(route.slots)


def test_a_conversion_still_gets_its_own_slot():
    """Only aliases collapse.  A wrapper converts, so it needs two.

    Without this the fix would quietly merge ETH into WETH and drop the wrap
    leg's destination, which is a different route breaking the same way.
    """
    nodes = merged_nodes()
    arcs = [arc(POOL_A, USDC, WETH, nodes, a=1 / 4000.0)]
    nu = np.zeros(nodes.n_nodes)
    nu[nodes.node(USDC)] = 1.0
    nu[nodes.node(WETH)] = 4000.0
    route = realize(arcs, np.array([1000.0]), nu, nodes,
                    src_token=USDC, dst_token=ETH, amount_in=1000 * 10**6)
    assert route.slots[WETH.lower()] != route.slots[ETH.lower()]
    assert route.dst_slot == route.slots[ETH.lower()]


# --------------------------------------------- a capped arc must not sweep
#
# `bps == 0` means "take whatever is left", which is how the last leg out of a
# node avoids stranding dust.  An arc with a finite `cap` cannot honour that:
# the cap is enforced in the solve and there is nowhere to put it in the
# calldata, so being last hands it the remainder whatever the solve decided.
#
# Measured on USDT -> ZCHF at $10,000.  The USD3 vault arc carries
# `cap = 5.0e-05` and `clamped`, the solve gave it nothing, and it came last
# out of the USDC slot -- so it swept 99.7% of the trade, 9,960 USDC into a
# vault whose `maxDeposit` is 1,142.  `previewDeposit` quotes that happily and
# `deposit` reverts, so the route was published and could not be executed.

def _capped(pool, token_in, token_out, nodes, *, cap, **kw):
    made = arc(pool, token_in, token_out, nodes, **kw)
    return replace(made, cap=cap, clamped=True)


def test_a_capped_arc_is_never_the_leg_that_sweeps():
    nodes = base_nodes()
    arcs = [
        _capped(POOL_A, USDC, WETH, nodes, cap=1e-4, a=1 / 4000.0),
        arc(POOL_B, USDC, WETH, nodes, a=1 / 4001.0),
    ]
    nu = np.zeros(nodes.n_nodes)
    nu[nodes.node(USDC)] = 1.0
    nu[nodes.node(WETH)] = 4000.0

    # The capped arc is first in `arcs` and carries the larger flow, so nothing
    # but the cap can push it off the sweeping position.
    route = realize(
        arcs, np.array([700.0, 300.0]), nu, nodes,
        src_token=USDC, dst_token=WETH, amount_in=1000 * 10**6,
    )
    sweepers = [rl for rl in route.legs if rl.leg.bps == 0]
    assert len(sweepers) == 1, "exactly one leg takes the remainder"
    assert sweepers[0].target.lower() == POOL_B.lower(), (
        "the uncapped arc sweeps; the capped one takes an explicit share")
    capped_leg = next(rl for rl in route.legs if rl.target.lower() == POOL_A.lower())
    assert capped_leg.leg.bps > 0


def test_nobody_sweeps_when_every_arc_in_the_group_is_capped():
    nodes = base_nodes()
    arcs = [
        _capped(POOL_A, USDC, WETH, nodes, cap=1e-4, a=1 / 4000.0),
        _capped(POOL_B, USDC, WETH, nodes, cap=1e-4, a=1 / 4001.0),
    ]
    nu = np.zeros(nodes.n_nodes)
    nu[nodes.node(USDC)] = 1.0
    nu[nodes.node(WETH)] = 4000.0

    route = realize(
        arcs, np.array([700.0, 300.0]), nu, nodes,
        src_token=USDC, dst_token=WETH, amount_in=1000 * 10**6,
    )
    # Rounding dust stays in the slot rather than being swept past a cap.  A few
    # wei stranded is a cost; a leg that sweeps past its cap is a reverted route.
    assert all(rl.leg.bps > 0 for rl in route.legs), "no leg takes the remainder"


def test_an_uncapped_arc_still_sweeps_when_one_exists():
    """The fix must not strand dust on ordinary routes."""
    nodes = base_nodes()
    arcs = [
        arc(POOL_A, USDC, WETH, nodes, a=1 / 4000.0),
        arc(POOL_B, USDC, WETH, nodes, a=1 / 4001.0),
    ]
    nu = np.zeros(nodes.n_nodes)
    nu[nodes.node(USDC)] = 1.0
    nu[nodes.node(WETH)] = 4000.0

    route = realize(
        arcs, np.array([700.0, 300.0]), nu, nodes,
        src_token=USDC, dst_token=WETH, amount_in=1000 * 10**6,
    )
    assert sum(rl.amount_in for rl in route.legs) == 1000 * 10**6
    assert sum(1 for rl in route.legs if rl.leg.bps == 0) == 1


# ---------------------------------------------- what the realised legs report


def test_theta_follows_the_amounts_it_describes():
    """`_forward_simulate` rescales the amounts; `theta` has to move with them.

    The model-free `direct`/`two-step` candidates are realised at `psi = 1` --
    under a token of flow -- and then replayed at the caller's real size.  A
    `theta` left at the realisation value reads 0.00% on a leg taking several
    times the pool, which is exactly the reading §12.1's size check exists to
    prevent.
    """
    nodes = base_nodes()
    reserve = 500 * 10**18
    one = arc(POOL_A, CRVUSD, WETH, nodes, reserve=reserve)
    route = realize(
        [one], np.array([1.0]), np.array([1.0, 1.0, 1.0]), nodes,
        src_token=CRVUSD, dst_token=WETH, amount_in=1800 * 10**18,
    )
    leg = route.legs[0]
    assert leg.amount_in == 1800 * 10**18       # replayed at the real size
    assert leg.theta == pytest.approx(1800 / 500)   # and theta says so
    assert leg.theta > 1.0                       # past the pool, and it shows


def test_an_uncalibrated_arc_is_not_reported_as_modelled():
    """`B = 0` is the model-free candidate's placeholder, not a linear pool.

    `direct_candidates` builds its arcs from the price fit alone: `B = 0`, so
    `G = 0`, so `eps` and the impact term are zero because nothing measured
    them.  Printing those as `eps +0.00 bp  R 0.00 bp` claims a fee-free,
    depthless pool, which is a stronger statement than the router can make.
    """
    nodes = base_nodes()
    free = replace(arc(POOL_A, CRVUSD, WETH, nodes), B=0.0, G=0.0, eps=0.0)
    fitted = arc(POOL_B, CRVUSD, WETH, nodes)
    for one, expected in ((free, False), (fitted, True)):
        route = realize(
            [one], np.array([1.0]), np.array([1.0, 1.0, 1.0]), nodes,
            src_token=CRVUSD, dst_token=WETH, amount_in=10**18,
        )
        assert route.legs[0].modelled is expected
