"""A pool that allowlists `add_liquidity` must not be offered a deposit arc.

Twocrypto stores an allowlist under `lp_allowlist`, with its own on/off switch
at the zero address.  When it is on, `add_liquidity` asserts
`lp_allowlist[msg.sender]` and refuses everyone else -- while
`calc_token_amount`, a view, answers for anybody.  So the arc quotes a number
nobody outside the list can get.

Measured on the four Yield Basis pools (WBTC, WETH, tBTC, cbBTC -- $245M of TVL
between them): every deposit quoted and every one reverted.  Nothing else on any
of the fifteen chains has the switch on.

Only the deposit is gated.  `exchange` and `remove_liquidity_one_coin` carry no
such check, so withholding the pool wholesale would throw away working arcs.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from erouter.core.nodes import NodeMap
from erouter.core.pipeline import build_arcs
from erouter.core.pools import Coin, PoolSpec
from erouter.core.transport import Answer, Status
from erouter.core.types import ArcKind, Dialect
from erouter.dev.universe import DEPOSIT_GATE_FLAG, resolve_deposit_gates

COIN_A = "0x" + "b1" * 20
COIN_B = "0x" + "b2" * 20


@dataclass
class Client:
    """Answers `lp_allowlist(address)` per pool; an absent entry has no getter."""

    switch: dict
    asked: list = field(default_factory=list)

    def raw(self, calls):
        out = []
        for call in calls:
            self.asked.append(call)
            state = self.switch.get(call.to.lower())
            out.append(Answer(Status.WRONG_ABI) if state is None
                       else Answer(Status.VALUE, int(state).to_bytes(32, "big")))
        return out


def _pool(address: str) -> PoolSpec:
    return PoolSpec(
        address=address, name="p", pool_type="twocryptong",
        coins=(Coin(COIN_A, "A", 18, 0), Coin(COIN_B, "B", 18, 1)),
        lp_token=address, lp_decimals=18, lp_supply=10**21,
        balances=(10**21, 10**21), dialect=Dialect.CRYPTO,
    )


def _nodes(*pools: PoolSpec) -> NodeMap:
    nodes = NodeMap()
    for token in (COIN_A, COIN_B):
        nodes.add_token(token)
    for pool in pools:
        nodes.add_token(pool.lp_token)
    return nodes


def test_the_switch_decides_not_the_presence_of_the_getter():
    on, off, absent = "0x" + "a1" * 20, "0x" + "a2" * 20, "0x" + "a3" * 20
    pools = [_pool(on), _pool(off), _pool(absent)]
    client = Client({on: 1, off: 0})

    assert resolve_deposit_gates(pools, client) == 1
    assert [p.deposit_gated for p in pools] == [True, False, False]
    # A pool with no getter is not gated: no allowlist is not a closed one.
    assert pools[2].deposit_gated is False
    # The question asked is about the switch, not about our own address.
    assert all(DEPOSIT_GATE_FLAG[2:] in call.data.hex() for call in client.asked)


def test_a_gated_pool_keeps_its_swaps_and_withdrawals():
    gated, open_ = _pool("0x" + "a1" * 20), _pool("0x" + "a2" * 20)
    gated.deposit_gated = True

    kinds = {}
    for pool in (gated, open_):
        refs, _meta = build_arcs([pool], _nodes(pool))
        kinds[pool.address] = {ref.kind for ref in refs}

    assert ArcKind.DEPOSIT_FIXED in kinds[open_.address]
    assert ArcKind.DEPOSIT_FIXED not in kinds[gated.address]
    for address, offered in kinds.items():
        assert ArcKind.SWAP_CRYPTO in offered, address
        assert ArcKind.WITHDRAW_CRYPTO in offered, address
