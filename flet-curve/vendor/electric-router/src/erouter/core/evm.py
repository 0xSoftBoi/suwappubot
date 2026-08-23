"""The three seams between a warmed local EVM and whatever is under it.

`transport.py` is the seam for "run this eth_call at this block".  This is the
seam one level down, for the frontend that answers those calls *itself*: an
EVM to execute in, a way to fetch the state it turns out to need, and a way to
read the committed caches.  Each is a Protocol for the same reason `Transport`
is -- so `core` can be handed a browser's implementation without importing
anything that knows about a browser.

`EvmBackend` is deliberately the surface `erouter_evm` already has, in both of
its bindings.  Nothing here adapts between them; they were written to agree.
"""

from __future__ import annotations

from typing import Protocol, runtime_checkable

#: Nobody, funded, so a `msg.sender` balance check never binds.  The same
#: address `dev/local_evm.py` uses, so a quote through either path has the
#: same caller and any `msg.sender`-dependent read answers the same way.
CALLER = "0x" + "11" * 20

#: What that account is given.  Large enough that no route's value transfer
#: runs it out, small enough not to overflow anything that sums balances.
CALLER_BALANCE = "0x" + f"{10 ** 24:x}"


@runtime_checkable
class EvmBackend(Protocol):
    """An in-process EVM holding prefetched state, and reporting its misses.

    Implemented twice over one Rust crate: `erouter_evm` as a CPython
    extension, and `erouter.wasm._evm` over the wasm module.  Addresses, slots
    and values are hex strings throughout -- JSON-RPC already speaks that, and
    a 256-bit integer has no representation that survives both bindings.
    """

    def set_block(self, number: int, timestamp: int, basefee: int = ...,
                  gas_limit: int = ..., coinbase: str = ..., prevrandao: str = ...,
                  excess_blob_gas: int | None = ...) -> None: ...

    def insert_account(self, address: str, nonce: int = ..., balance: str = ...,
                       code: bytes | None = ...) -> None: ...

    def set_balance(self, address: str, balance: str) -> None: ...

    def insert_storage(self, address: str, slot: str, value: str) -> None: ...

    def insert_storage_many(self, entries) -> None: ...

    def has_account(self, address: str) -> bool: ...

    def known_slots(self) -> list[tuple[str, str]]: ...

    def take_misses(self) -> dict: ...

    def call(self, caller: str, to: str, data: bytes, value: str = ...,
             gas_limit: int = ...) -> dict: ...

    def call_many(self, caller: str, calls, gas_limit: int = ...) -> list[dict]: ...


@runtime_checkable
class AsyncRpc(Protocol):
    """Batched JSON-RPC, awaited.

    Async because the browser's only transport is, and because the sweep is a
    few thousand tiny independent reads: `dev/rpc.py` measured 200 in one batch
    at 68 ms against 33.6 ms *each* sequentially, and several batches at once
    against one.  A frontend gets both by handing over its own client.

    `batch` must return one entry per request, in order, and must never raise
    for a single failed request -- an `Exception` in that slot is how one says
    so, exactly as `Answer.status` does a level up.
    """

    @property
    def chain_id(self) -> int: ...

    async def batch(self, requests: list[tuple[str, list]]) -> list: ...

    async def call(self, method: str, params: list): ...


@runtime_checkable
class DataSource(Protocol):
    """The committed caches, however this frontend gets at them.

    A slot list, a set of model verdicts and a facts file are all read-only
    inputs a browser fetches over HTTP and a CLI reads off disk.  `load`
    returns `None` for something that is not there, which is never an error:
    every one of them is an optimisation that the code can do without, more
    slowly or more cautiously.
    """

    async def load(self, name: str) -> bytes | None: ...
