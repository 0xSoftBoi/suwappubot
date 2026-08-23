"""The session must be the CLI, at one block, on one universe.

`chain/session.py` is `dev/cli.py::cmd_route`'s stages rearranged for a
frontend -- async, resumable, and discovering state from what a call *could
not read* rather than from an access list.  Rearranged is the operative word:
the answer has to be the same one, or the browser is a different router.

So this runs the real CLI in a subprocess rather than a reconstruction of it,
against the same pinned block, the same pool list and the same gas price --
the three inputs a quote is not comparable across.

What it caught, and the reason it exists: the miss loop re-runs its stage
until nothing is missing, and several stages *mutate* -- a pool that looks
insolvent has its balances zeroed, which is how a drop is expressed.  Run
against incomplete state, thirty solvent crypto pools were dropped, 79
SWAP_CRYPTO arcs never existed, and the quote came out 2.2 bp light with
nothing anywhere reporting an error.  `arcs_planned` is what noticed.
"""

from __future__ import annotations

import asyncio
import json
import subprocess
import sys

import pytest

pytestmark = pytest.mark.forked

USDC = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"
WETH = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2"
AMOUNT_HUMAN = "100000"
AMOUNT = 100_000 * 10**6

#: Gas is priced into candidate selection, so two runs are only comparable at
#: the same gas price.  Fixed rather than read off the chain.
GAS_GWEI = 1
MIN_TVL = 10_000.0


class _Rpc:
    """The `AsyncRpc` protocol over the CLI's own synchronous transport.

    Deliberately the same endpoint, so a difference cannot be one half talking
    to a different node.
    """

    batch_size = 100

    def __init__(self, transport):
        self._transport = transport
        self.chain_id = transport.chain_id

    async def batch(self, requests):
        return self._transport.fetch_multi(list(requests), concurrent=True)

    async def call(self, method, params):
        got = self._transport.fetch_multi([(method, params)])[0]
        if isinstance(got, Exception):
            raise got
        return got


class _Files:
    """The `DataSource` protocol over the checkout's own `data/`."""

    def __init__(self, root):
        self._root = root

    async def load(self, name):
        path = self._root / "data" / name
        return path.read_bytes() if path.exists() else None


@pytest.fixture(scope="module")
def universe(chain):
    """The cached pool rows, and a guarantee the CLI will use the same ones.

    The pool list is the one input `--block` does not pin, so the CLI is run
    with `--pin-universe` -- whatever is on disk, however old, and never a
    request -- and the session is handed the same rows.
    """
    from erouter.chain.cache import UniverseCache
    from erouter.dev.universe import load_pools

    cache = UniverseCache()
    if cache.get(chain.chain_id, MIN_TVL, allow_stale=True) is None:
        load_pools(chain, min_tvl=MIN_TVL)
    raw = cache.get(chain.chain_id, MIN_TVL, allow_stale=True)
    if raw is None:
        pytest.skip("no universe to hand to both halves")
    return json.loads(json.dumps(raw))


def _cli(chain, block: int, out) -> dict:
    done = subprocess.run(
        [sys.executable, "-m", "erouter.dev.cli", "route",
         "--from", "USDC", "--to", "WETH", "--amount", AMOUNT_HUMAN,
         "--chain", chain.name, "--block", str(block),
         "--gas-price", str(GAS_GWEI), "--pin-universe",
         "--json", str(out)],
        capture_output=True, text=True, timeout=1800,
    )
    if not out.exists():
        pytest.skip(f"the CLI could not route here:\n{done.stdout[-800:]}")
    return json.loads(out.read_text())


def test_the_session_reproduces_the_cli(chain, rpc, universe, tmp_path):
    from pathlib import Path

    from erouter.chain.session import RouterSession

    erouter_evm = pytest.importorskip("erouter_evm")
    root = Path(__file__).resolve().parents[2]
    block = rpc.block

    session = RouterSession(
        chain, _Rpc(rpc), erouter_evm.Evm("Osaka", chain.chain_id),
        _Files(root), universe, min_tvl=MIN_TVL)
    report = asyncio.run(session.warm(block=block))
    assert report.complete, (
        f"warm left {report.unreadable} slot(s) unread: {report.warnings}")
    session.gas_price_wei = GAS_GWEI * 10**9
    asyncio.run(session.set_pair(USDC, WETH))
    mine = session.quote(AMOUNT)

    theirs = _cli(chain, block, tmp_path / "cli.json")
    diagnostics = theirs["diagnostics"]

    # The arcs first: a route that differs almost always differs because the
    # universe it was chosen from did, and one number says so.
    assert report.pools == diagnostics["pools"], "different pool counts"
    assert session.prepared.counters["arcs_planned"] == diagnostics["arcs_planned"]
    assert session.prepared.counters["arcs_calibrated"] == diagnostics["arcs_calibrated"]

    assert str(mine.verified_out) == str(theirs["result"]["amount_out"]), (
        f"session {mine.verified_out} against the CLI's "
        f"{theirs['result']['amount_out']} at block {block}"
    )
    assert len(mine.route.legs) == len(theirs["legs"])
