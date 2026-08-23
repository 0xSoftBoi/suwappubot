"""Hosting RouteQuoter.vy: two backends, one client.

`OverrideHost` is the production path -- inject the contract's runtime bytecode
with an `eth_call` state override and quote in one round trip, nothing deployed.
Verifying 20 candidates by real fork execution instead costs 1-2 minutes cold: a
sequential `eth_getStorageAt` is 33.6 ms even against a local node and a swap
leg touches tens of slots.

`BoaHost` runs the same contract inside boa, so tests exercise the whole client
path with no chain; it is also the fallback for a node that rejects overrides.
"""

from __future__ import annotations

import functools
import pathlib
from pathlib import Path
from typing import Any

from ..core.quoter import QuoterClient
from ..core.transport import Answer, Call, Status
from .rpc import JsonRpcTransport, RpcError

CONTRACT = pathlib.Path(__file__).resolve().parents[3] / "contracts" / "RouteQuoter.vy"

# Any address with no code; the override puts the quoter here for one call.
SCRATCH = "0x" + "ee" * 20


@functools.lru_cache(maxsize=1)
def _deployer():
    import boa

    return boa.loads_partial(CONTRACT.read_text(), name="RouteQuoter")


#: The compiled runtime, committed beside the source.
RUNTIME = Path(__file__).resolve().parents[3] / "data" / "quoter" / "RouteQuoter.runtime.hex"


@functools.lru_cache(maxsize=1)
def runtime_bytecode() -> bytes:
    """What a state override injects.

    Read from disk rather than compiled, because compiling needs boa and vyper
    and the override path has to work where neither exists -- the Flet frontend
    runs under Pyodide.  Compiling stays as the fallback *here*, where a
    developer has the tools, and `tests/test_quoter_bytecode.py` holds the
    committed copy to what the source compiles to, so it cannot rot silently.
    """
    try:
        text = RUNTIME.read_text()
    except OSError:
        text = ""
    body = "".join(line.strip() for line in text.splitlines()
                   if line.strip() and not line.startswith("#"))
    if body:
        return bytes.fromhex(body)
    return _deployer().compiler_data.bytecode_runtime


def override_client(rpc: JsonRpcTransport, address: str = SCRATCH) -> QuoterClient:
    """Quoter injected into an eth_call.  No deployment, one round trip."""
    overrides = {address: {"code": "0x" + runtime_bytecode().hex()}}
    return QuoterClient(rpc, address, overrides=overrides)


def quoter_client(rpc: JsonRpcTransport, chain) -> QuoterClient:
    """The deployed quoter when the chain has one, else the override.

    Prefer deployed: it sends 7,486 fewer bytes per call and needs neither a
    compiler nor state-override support, so the same path works from a browser.
    The override stays as the fallback because it needs no deployment at all,
    which is what makes a new chain routable on day one.
    """
    address = (getattr(chain, "quoter", "") or "").strip()
    if address:
        return QuoterClient(rpc, address)
    return override_client(rpc)


class BoaHost:
    """`Transport` backed by boa's EVM (plain local env, or a fork)."""

    def __init__(self, address: str | None = None) -> None:
        import boa

        self._boa = boa
        if address is None:
            self.contract = _deployer().deploy()
            self.address = str(self.contract.address)
        else:
            self.contract = None
            self.address = address

    # -- Transport ---------------------------------------------------------

    @property
    def block(self) -> int:
        return int(self._boa.env.evm.patch.block_number)

    @property
    def chain_id(self) -> int:
        return int(self._boa.env.evm.patch.chain_id)

    def call(self, to: str, data: bytes, *, overrides: dict | None = None) -> bytes:
        code = None
        if overrides and to in overrides and "code" in overrides[to]:
            raw = overrides[to]["code"]
            code = bytes.fromhex(raw[2:] if raw.startswith("0x") else raw)
        computation = self._boa.env.execute_code(
            to_address=to,
            data=data,
            is_modifying=False,
            override_bytecode=code,
        )
        if computation.is_error:
            raise RpcError(f"execution reverted: {computation.error}")
        return bytes(computation.output)

    def call_many(self, calls: list[Call], *, overrides: dict | None = None) -> list[Answer]:
        out: list[Answer] = []
        for c in calls:
            try:
                raw = self.call(c.to, c.data, overrides=overrides)
            except RpcError as exc:
                out.append(Answer(Status.REVERTED, message=str(exc)))
                continue
            out.append(Answer(Status.VALUE, raw) if raw else Answer(Status.WRONG_ABI))
        return out

    # -- convenience -------------------------------------------------------

    def client(self, **kwargs: Any) -> QuoterClient:
        return QuoterClient(self, self.address, **kwargs)


def fork_client(url: str, block: int, *, prefetch: bool | None = None) -> QuoterClient:
    """Fork `url` at `block`, deploy the quoter, and return a client.

    `prefetch=None` probes for `debug_traceCall`.  Note this inverts yb-core's
    idiom: with prestateTracer served, prefetching costs 0.127 s per message
    against 33.6 ms per *slot* without it -- but against a remote endpoint that
    serves no `debug_*` it must be off.
    """
    import boa

    if prefetch is None:
        probe = JsonRpcTransport(url, block=block)
        prefetch = probe.supports_debug_trace()

    # `allow_dirty` because boa's env is process-global and any earlier forked
    # test may have deployed into it.  Without it this raises "Cannot fork with
    # dirty state", which made the forked suite pass or fail on collection order
    # alone.  Forking rebuilds state from the chain regardless.
    boa.fork(url, block_identifier=block, allow_dirty=True)
    boa.env.evm._fork_try_prefetch_state = bool(prefetch)
    return BoaHost().client()
