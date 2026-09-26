"""The native token is a node wherever its wrapper is one.

The merge used to be gated on some pool holding Curve's `0xEeee..` sentinel as
a coin.  Eight mainnet pools do, so ETH worked; nothing on gnosis, base,
polygon, monad or etherlink does, so the gas token was not in the graph at all
and `XDAI -> USDC.e` answered "not routable" for a pair whose second leg was
already there.  Either side being present is enough -- the merge adds an alias
onto the wrapper's node, not a node and not an arc.

What it must still refuse is a chain whose `wrapped` is not a wrapper.
Fraxtal's `0xFC00..06` is an `OptimismMintableERC20` for L1 frxETH: it answers
the whole ERC20 surface, holds no native, and has no `deposit` for a
`WRAP_NATIVE` leg to call.  That is declared, not probed -- see
`tests/live/test_native_wrappers.py` for the check against the chains.
"""

from __future__ import annotations

from dataclasses import dataclass, replace

from erouter.chain import chains as chain_table
from erouter.chain.wrappers import build_node_map
from erouter.core.transport import Answer, Status

SENTINEL = chain_table.NATIVE_SENTINEL.lower()
USDC = "0x" + "0c" * 20


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
    """Refuses everything.  A native wrapper needs no read: it is 1:1."""

    def raw(self, calls):
        return [Answer(Status.REVERTED, b"") for _ in calls]


def wrapper_pool(chain):
    return [Pool("0x" + "a1" * 20,
                 [Coin(chain.wrapped, symbol=f"W{chain.native_symbol}"),
                  Coin(USDC, symbol="USDC")])]


def sentinel_pool(chain):
    return [Pool("0x" + "a2" * 20,
                 [Coin(SENTINEL, symbol=chain.native_symbol),
                  Coin(USDC, symbol="USDC")])]


def test_the_wrapper_alone_puts_the_native_token_in_the_graph():
    """Gnosis: four pools hold WXDAI, none holds the sentinel."""
    chain = chain_table.get("gnosis")
    nodes, report = build_node_map(wrapper_pool(chain), chain, Client())
    assert nodes.has(SENTINEL), "XDAI is not a node, so nothing can be routed from it"
    assert nodes.node(SENTINEL) == nodes.node(chain.wrapped.lower())
    assert ("XDAI", "WXDAI") in report.native_merged


def test_the_sentinel_alone_still_works():
    """Mainnet's shape, and the only one the old gate allowed."""
    chain = chain_table.get("ethereum")
    nodes, _ = build_node_map(sentinel_pool(chain), chain, Client())
    assert nodes.node(SENTINEL) == nodes.node(chain.wrapped.lower())


def test_merging_adds_no_node_and_no_arc():
    """It is an alias onto the wrapper's own node.  A dead-end node would drag
    the price fit and the solver -- measured at 759 arcs becoming 2,020."""
    chain = chain_table.get("gnosis")
    plain = replace(chain, wraps_native=False)
    before, _ = build_node_map(wrapper_pool(chain), plain, Client())
    after, _ = build_node_map(wrapper_pool(chain), chain, Client())
    assert after.n_nodes == before.n_nodes


def test_a_chain_without_a_real_wrapper_is_left_alone():
    """Fraxtal: `wrapped` is a bridge token with no `deposit` to call, so a
    `WRAP_NATIVE` leg would revert.  Better no node than a reverting one."""
    chain = chain_table.get("fraxtal")
    assert not chain.wraps_native, "the declaration this test rests on"
    nodes, report = build_node_map(wrapper_pool(chain), chain, Client())
    assert nodes.has(chain.wrapped.lower()), "the ERC20 itself still trades"
    assert not nodes.has(SENTINEL), "but the gas token is not the same asset"
    assert report.native_merged == []


def test_no_chain_merges_a_wrapper_it_cannot_call():
    """The declaration and the table, kept in step."""
    for name, chain in chain_table.CHAINS.items():
        nodes, _ = build_node_map(wrapper_pool(chain), chain, Client())
        assert nodes.has(SENTINEL) is bool(chain.wraps_native), (
            f"{name}: wraps_native={chain.wraps_native} but "
            f"native node={nodes.has(SENTINEL)}")
