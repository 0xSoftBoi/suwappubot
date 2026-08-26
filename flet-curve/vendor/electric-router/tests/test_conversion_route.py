"""Two tokens of one node still have an answer: the conversion itself.

Merging is what lets the solve treat crvUSD and scrvUSD as one place, and it
is also why no arc runs between them -- so asking for that pair used to raise.
That is right about the model and wrong about the question: a deposit into
scrvUSD is a trade a user can make, and Curve's own router quotes it.
"""

from __future__ import annotations

import pytest

from erouter.core.nodes import Conversion, ConversionKind, NodeMap
from erouter.core.realize import conversion_route

CRVUSD = "0x" + "f9" * 20
SCRVUSD = "0x" + "06" * 20
EURE_A = "0x" + "e1" * 20
EURE_B = "0x" + "e2" * 20


def vault_nodes() -> NodeMap:
    nodes = NodeMap()
    nodes.add_token(CRVUSD, "crvUSD", 18)
    nodes.add_token(SCRVUSD, "scrvUSD", 18)
    nodes.merge(Conversion(ConversionKind.ERC4626, SCRVUSD, CRVUSD,
                           rate_num=11 * 10**17, rate_den=10**18, target=SCRVUSD))
    return nodes


def alias_nodes() -> NodeMap:
    nodes = NodeMap()
    nodes.add_token(EURE_A, "EURe", 18)
    nodes.add_token(EURE_B, "EURe2", 18)
    nodes.merge(Conversion(ConversionKind.ALIAS, EURE_B, EURE_A, target=EURE_B))
    return nodes


def test_the_deposit_is_a_one_leg_route():
    nodes = vault_nodes()
    route = conversion_route(nodes, src_token=CRVUSD, dst_token=SCRVUSD,
                             amount_in=10**24)
    assert len(route.legs) == 1
    leg = route.legs[0]
    assert leg.token_in.lower() == CRVUSD and leg.token_out.lower() == SCRVUSD
    assert leg.is_conversion
    assert route.dst_slot == 1
    assert route.amount_in == 10**24


def test_the_withdrawal_is_the_same_route_backwards():
    nodes = vault_nodes()
    route = conversion_route(nodes, src_token=SCRVUSD, dst_token=CRVUSD,
                             amount_in=10**24)
    assert len(route.legs) == 1
    leg = route.legs[0]
    assert leg.token_in.lower() == SCRVUSD and leg.token_out.lower() == CRVUSD


def test_every_slot_knows_its_node():
    """Without this the renderer labels each bus from node 0, which drew
    "crvUSD = DAI/sDAI" over a crvUSD -> scrvUSD deposit."""
    nodes = vault_nodes()
    route = conversion_route(nodes, src_token=CRVUSD, dst_token=SCRVUSD,
                             amount_in=10**24)
    node = nodes.node(CRVUSD)
    assert route.node_of_slot == {0: node, 1: node}


def test_an_alias_pair_emits_no_leg_and_loses_nothing():
    """Holding one *is* holding the other, so there is nothing to call."""
    nodes = alias_nodes()
    route = conversion_route(nodes, src_token=EURE_A, dst_token=EURE_B,
                             amount_in=777)
    assert route.legs == []
    assert route.modelled_out == 777


def test_a_token_to_itself_is_still_refused():
    from erouter.core.pipeline import RoutingError
    from erouter.core.pipeline import route as route_fn

    nodes = vault_nodes()
    with pytest.raises(RoutingError, match="itself"):
        route_fn([], nodes, None, src_token=CRVUSD, dst_token=CRVUSD,
                 amount_in=10**18)
