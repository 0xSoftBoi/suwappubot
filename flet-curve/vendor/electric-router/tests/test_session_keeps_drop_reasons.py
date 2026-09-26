"""A pool that vanishes has to say why.

`check_reserves_are_real` drops a pool that reports more than it holds, and it
expresses the drop by zeroing that pool's balances -- which is silent.  The CLI
prints the reasons it returns; the session built the same list and threw it
away, so a frontend had a pool that was there a moment ago and nothing to tell
anyone about it.

Measured on polygon: five of twenty-four pools go this way, four on retired
am3CRV and one -- `WMATIC/TRICRYPTO` -- reporting 139,834.59 WPOL against the
single wei the token says it holds.  That last one is the only pool above the
floor holding WPOL, so it is the whole reason the chain's gas token routes
nowhere, and the session said nothing at all about it.
"""

from __future__ import annotations

import asyncio

from erouter.chain import chains as chain_table
from erouter.chain.session import RouterSession
from erouter.core.pools import Coin, PoolSpec

WPOL = "0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270"
LP = "0x" + "1c" * 20


class _Evm:
    """`fill` without a chain: run the thunk once and report nothing missing."""

    async def fill(self, rpc, run, *, block=None, code_for=None):
        return run()


class _Client:
    """Answers nothing.  The pool rows below are already populated, so the
    stages either skip them or learn nothing, and only the reserve check --
    which reads what is already on the row -- has anything to say."""

    def raw(self, calls):
        from erouter.core.transport import Answer, Status
        return [Answer(Status.REVERTED, b"") for _ in calls]

    def probe(self, probes):
        from erouter.core.transport import Answer, Status
        return [Answer(Status.REVERTED, b"") for _ in probes]


def _short_pool():
    """Polygon's WMATIC/TRICRYPTO, at the numbers the chain really gives."""
    return PoolSpec(
        address="0x7bbc0e92505b485aeb3e82e828cb505daf1e50c6",
        name="Curve.fi Factory Crypto Pool: WMATIC/TRICRYPTO",
        pool_type="factory_crypto",
        coins=(Coin(index=0, address=WPOL, symbol="WPOL", decimals=18),
               Coin(index=1, address=LP, symbol="crvUSDBTCETH", decimals=18)),
        tvl_usd=30_056.0,
        balances=(139_834_587_079_470_069_173_372, 6_802_044_592_899_676_986),
        held=(1, 6_802_044_592_899_676_986),
    )


def _session(pools):
    session = object.__new__(RouterSession)
    session.chain = chain_table.get("polygon")
    session.client = _Client()
    session.evm = _Evm()
    session.rpc = None
    session.block = 0
    session.pools = pools
    session.notes = []
    session.facts = {}
    return session


def test_a_dropped_pool_leaves_a_reason_behind():
    session = _session([_short_pool()])
    asyncio.run(session._resolve_pools(lambda *a, **k: None))
    assert session.notes, (
        "the pool was dropped and the session had nothing to say about it")
    said = " ".join(session.notes)
    assert "WMATIC/TRICRYPTO" in said and "WPOL" in said


def test_the_drop_itself_still_happens():
    """The reason is additional to the drop, not instead of it."""
    pools = [_short_pool()]
    asyncio.run(_session(pools)._resolve_pools(lambda *a, **k: None))
    assert pools[0].balances == (0, 0), "zeroing is how the drop is expressed"


def test_a_solvent_pool_says_nothing():
    pool = _short_pool()
    pool.held = pool.balances
    session = _session([pool])
    asyncio.run(session._resolve_pools(lambda *a, **k: None))
    assert session.notes == []
    assert pool.balances[0] > 0
