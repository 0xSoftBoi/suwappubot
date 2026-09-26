"""A pool the rate reader rescues must not stay remembered as unquotable.

`ETH/aETH` reproduces its own `get_dy` to the wei at every size asked, through
the wrapper rates in `lending_params`.  It reaches that reader by being
*rejected* first -- and the rejection was written to the cache and never
withdrawn, so the next run skipped the pool before the gate, it never landed in
`rejected`, and `rejected` is what feeds the reader that rescues it.  A model
that works locked itself out on its second run, and stayed out: the entry lapses
only when the balances move, and a pool nobody can route through does not trade.
"""

from __future__ import annotations

import ast
from pathlib import Path

import pytest

from erouter.chain import stable_params
from erouter.chain.exact_cache import MATH_SOURCES, ExactCache
from erouter.chain.stable_params import build_exact_pools
from erouter.core.quoter import Quote
from erouter.core.stableswap import StableSwap
from erouter.core.transport import Answer, Status


def _shaped() -> dict:
    return {"balances": (10**24, 10**24), "rates": (10**18, 10**18), "amp": 2000 * 100,
                "fee": 4_000_000, "offpeg_fee_multiplier": 0, "a_precision": 100}


class _Pool:
    """Just enough of a `PoolSpec` for the reader under test."""

    def __init__(self, address: str, n: int = 2):
        self.address = address
        self.coins = tuple(_Coin() for _ in range(n))
        self.balances = tuple(10**24 for _ in range(n))
        self.lp_token = None
        self.swap_kind = None
        self.name = "test"


class _Coin:
    address = "0x" + "00" * 20
    decimals = 18
    symbol = "T"

class _GateClient:
    """Answers parameter reads and quotes a number no plain reading matches."""

    block = 1

    def __init__(self):
        self.probed: list = []

    def raw(self, calls):
        # `A_precise`, `A`, `fee`, `offpeg_fee_multiplier`, `admin_fee`.
        cycle = (2000 * 100, 0, 4_000_000, 0, 0)
        return [
            Answer(Status.VALUE, cycle[k % 5].to_bytes(32, "big"))
            if cycle[k % 5] else Answer(Status.REVERTED)
            for k in range(len(calls))
        ]

    def probe(self, probes):
        self.probed.extend(probes)
        # Nothing built from a decimals-only rate reproduces this, which is the
        # position a wrapped-token pool is in before its rate is found.
        return [Quote(Status.VALUE, 12_345) for _ in probes]


@pytest.fixture()
def _rescued(monkeypatch):
    """`build_exact_rate_pools` finds the rate the ordinary reading could not."""
    model = StableSwap(fee_on_xp=True, subtract_one=True, **_shaped())
    monkeypatch.setattr(stable_params, "build_exact_lending",
                        lambda *a, **k: ({}, []))
    monkeypatch.setattr(stable_params, "build_exact_rate_pools",
                        lambda pools, client, **k: {p.address.lower(): model
                                                    for p in pools})
    return model


def test_a_rescued_pool_is_not_written_to_unquotable(tmp_path: Path, _rescued):
    address = "0x" + "a9" * 20
    pools = [_Pool(address)]
    cache = ExactCache.load(1, "t", tmp_path)

    out = build_exact_pools(pools, _GateClient(), cache=cache)
    assert address in out.by_pool, "the fixture's retry did not run"
    cache.save()

    assert address not in cache.unquotable, (
        "a pool that reproduces its own get_dy was remembered as unquotable, "
        "because the refusal the ordinary reading recorded was never withdrawn"
    )
    assert address not in ExactCache.load(1, "t", tmp_path).unquotable


def test_a_rescued_pool_still_reaches_the_gate_next_run(tmp_path: Path, _rescued):
    """The harm the stale refusal does, stated as the run after it.

    `skip` is read before the gate, so a remembered refusal does not merely
    cost a re-check -- it removes the pool from `rejected`, and `rejected` is
    what the reader that rescues it is fed.
    """
    address = "0x" + "a9" * 20
    pools = [_Pool(address)]

    cache = ExactCache.load(1, "t", tmp_path)
    build_exact_pools(pools, _GateClient(), cache=cache)
    cache.save()

    again = ExactCache.load(1, "t", tmp_path)
    assert not again.skip(address, pools[0].balances)
    second = _GateClient()
    out = build_exact_pools(pools, second, cache=again)
    assert second.probed, (
        "the pool was skipped on a remembered refusal, so it never reached "
        "`rejected` and the retry that models it never saw it"
    )
    assert address in out.by_pool


def test_a_pool_nothing_rescues_is_still_remembered(tmp_path: Path, monkeypatch):
    """Readmitting must not disarm the refusal for pools that deserve one."""
    monkeypatch.setattr(stable_params, "build_exact_lending", lambda *a, **k: ({}, []))
    monkeypatch.setattr(stable_params, "build_exact_rate_pools", lambda *a, **k: {})
    address = "0x" + "de" * 20
    pools = [_Pool(address)]

    cache = ExactCache.load(1, "t", tmp_path)
    build_exact_pools(pools, _GateClient(), cache=cache)
    cache.save()
    assert address in cache.unquotable
    assert ExactCache.load(1, "t", tmp_path).skip(address, pools[0].balances)


# ------------------------------------------------------- fingerprint coverage


def test_every_reader_that_builds_a_model_is_fingerprinted():
    """A verdict is only safe while the maths behind it cannot move unseen.

    `math_fingerprint` exists so that editing an invariant discards every
    verdict that was reached with it.  The rate readers choose which variant a
    wrapped-token or oracle-priced pool is built from, so they decide verdicts
    too -- and `lending_params` was not in the digest, so changing the getters
    a rate may come from left every cached verdict on every chain standing.
    """
    tree = ast.parse(Path(stable_params.__file__).read_text())
    delegated = {
        node.module.split(".")[-1]
        for node in ast.walk(tree)
        if isinstance(node, ast.ImportFrom) and node.module
        and any(alias.name.startswith("build_exact") for alias in node.names)
    }
    covered = {name.removesuffix(".py") for _package, name in MATH_SOURCES}
    assert delegated <= covered, (
        f"{sorted(delegated - covered)} build models but do not move the "
        f"fingerprint, so editing them leaves stale verdicts trusted"
    )
