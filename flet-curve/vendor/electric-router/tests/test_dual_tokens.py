"""Two addresses that are one market but not one balance.

`discover_aliases` merges tokens that agree to the wei -- same supply, same
balance at every holder tried.  Gnosis EURe does not: v1 and v2 hold different
amounts and it refuses them, which is right on the evidence it has.  They are
still interchangeable, because a swap denominated in one settles against the
other with no contract in between.  That is not readable, so it is declared.

Held apart, `--to EURe` picks the deeper side and the market behind the other is
unreachable: three pools become two plus an orphan.
"""

from __future__ import annotations

from dataclasses import dataclass, replace

import numpy as np

from erouter.chain import chains as chain_table
from erouter.chain.wrappers import build_node_map
from erouter.core.realize import realize
from erouter.core.transport import Answer, Status
from erouter.core.types import ArcKind, PoolArc

V1 = "0x" + "e1" * 20
V2 = "0x" + "e2" * 20
OTHER = "0x" + "0c" * 20

GNOSIS_EURE = ("0xcB444e90D8198415266c6a2724b7900fb12FC56E",
               "0x420CA0f9B9b604cE0fd9C18EF134C705e5Fa3430")


@dataclass
class Coin:
    address: str
    decimals: int = 18
    symbol: str = "X"


@dataclass
class Pool:
    address: str
    coins: list
    n_coins: int = 2
    balances: tuple = ()
    tvl_usd: float = 100_000.0
    base_pool: str = ""
    lp_token: str = ""
    name: str = "pool"


class Client:
    """Refuses everything.  Nothing here should need a chain read."""

    def raw(self, calls):
        return [Answer(Status.REVERTED, b"") for _ in calls]


def pools():
    return [
        Pool("0x" + "a1" * 20, [Coin(V1, symbol="EURe"), Coin(OTHER, symbol="USDC")],
             tvl_usd=700_000.0),
        Pool("0x" + "a2" * 20, [Coin(V2, symbol="EURe"), Coin(OTHER, symbol="USDC")],
             tvl_usd=170_000.0),
    ]


def chain_with_duals():
    return replace(chain_table.get("gnosis"), duals=((V1, V2),))


def test_a_declared_dual_becomes_one_node():
    nodes, report = build_node_map(pools(), chain_with_duals(), Client())
    assert nodes.has(V1) and nodes.has(V2)
    assert nodes.node(V1) == nodes.node(V2), (
        "declared duals stayed two nodes, so one side's market is unreachable")
    assert (V2.lower(), V1.lower()) in [(a.lower(), b.lower())
                                        for a, b in report.aliases]


def test_the_deeper_side_is_canonical():
    """Legs stay denominated in the token most pools already hold."""
    nodes, _ = build_node_map(pools(), chain_with_duals(), Client())
    assert nodes.canonical_of[nodes.node(V1)].lower() == V1.lower()


def test_without_the_declaration_they_stay_apart():
    """The point of declaring: no read would have merged these."""
    nodes, report = build_node_map(pools(), replace(chain_table.get("gnosis"),
                                                    duals=()), Client())
    assert nodes.node(V1) != nodes.node(V2)
    assert not report.aliases


def test_gnosis_declares_the_eure_pair():
    """The addresses themselves, so a table edit cannot quietly drop them."""
    declared = {(a.lower(), b.lower())
                for a, b in chain_table.get("gnosis").duals}
    assert (GNOSIS_EURE[0].lower(), GNOSIS_EURE[1].lower()) in declared


def _arc(pool: str, token_in: str, nodes) -> PoolArc:
    return PoolArc(
        id=f"{pool}:0>1", pool=pool, kind=ArcKind.SWAP_STABLE, i=0, j=1, n_coins=2,
        token_in=token_in, token_out=OTHER,
        tau=nodes.node(token_in), sigma=nodes.node(OTHER),
        a=1.0, B=1e-9, decimals_in=18, decimals_out=18, tvl_usd=100_000.0,
    )


def test_flow_leaving_both_halves_of_an_alias_is_realisable():
    """One node, two addresses, an arc drawing on each.

    `realize.slot` collapses an alias onto its canonical deliberately -- two
    contracts over one balance, as gnosis's two EURe are -- so an arc whose input
    is the alias is already drawing on the hub's slot.  The hub check compared
    *addresses*, so that arc was sent down the spoke path and the conversion leg
    built for it moved slot 0 to slot 0, which `Leg` refuses.

    It takes both halves to reach: with flow leaving only one address the hub is
    reassigned to it and the comparison is true either way.  Two arcs pin the hub
    to the canonical and put the alias on the spoke path -- the real gnosis shape,
    where `EURe -> USDC` at 10,000 died with "leg must move between slots".
    """
    nodes, _ = build_node_map(pools(), chain_with_duals(), Client())
    canonical, alias = nodes.canonical(V1), V2
    assert nodes.node(canonical) == nodes.node(alias), "the fixture must merge them"
    assert canonical.lower() != alias.lower(), "and must keep two addresses"

    arcs = [_arc("0x" + "a1" * 20, canonical, nodes),
            _arc("0x" + "a2" * 20, alias, nodes)]
    route = realize(arcs, np.array([0.5, 0.5]), np.ones(nodes.n_nodes), nodes,
                    src_token=canonical, dst_token=OTHER, amount_in=10**20)

    assert len(route.legs) == 2, f"both arcs should carry flow: {route.legs}"
    for leg in route.wire_legs:
        assert leg.src_slot != leg.dst_slot, (
            f"a leg from slot {leg.src_slot} to itself cannot be executed")


def test_flow_arriving_at_the_alias_is_realisable():
    """The same collapse, at the other end of the route.

    Asking for the alias by address means `dst_lower != dst_canonical` while
    both sit in one slot, so the trailing conversion leg had a source and a
    destination that were the same accumulator.  There is nothing to convert --
    that is what declaring them duals says -- so the leg should not exist.

    Found by fuzzing gnosis, where `--to` the second EURe raised out of `Leg`
    instead of quoting.
    """
    nodes, _ = build_node_map(pools(), chain_with_duals(), Client())
    canonical, alias = nodes.canonical(V1), V2
    assert canonical.lower() != alias.lower(), "the fixture must keep two addresses"

    arc = replace(_arc("0x" + "a1" * 20, canonical, nodes),
                  token_in=OTHER, token_out=canonical,
                  tau=nodes.node(OTHER), sigma=nodes.node(canonical))
    route = realize([arc], np.array([1.0]), np.ones(nodes.n_nodes), nodes,
                    src_token=OTHER, dst_token=alias, amount_in=10**20)

    for leg in route.wire_legs:
        assert leg.src_slot != leg.dst_slot, (
            f"a leg from slot {leg.src_slot} to itself cannot be executed")
    assert route.dst_slot == route.slots[canonical.lower()], (
        "the alias must read the balance the legs actually delivered into")
