"""The one seam between the pure solver and the outside world.

Everything `core/` needs from a chain is "run this eth_call at this block".
Keeping that to a single small Protocol is what lets the frontend hand in its
own provider -- ~/Projects/flet-curve-demo already exposes exactly this shape
(`WalletProvider.request` / `.call`) -- instead of `core/` growing a dependency
on `requests` or on a particular RPC client.

`Answer` is three-state on purpose: a Curve pool that does not implement a
function returns *empty* data rather than reverting, so "call succeeded" and
"call returned a value" are different questions, and conflating them
mis-dispatches real mainnet pools today.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Protocol, runtime_checkable


class Status(Enum):
    VALUE = "VALUE"  # returned >= 32 bytes
    WRONG_ABI = "WRONG_ABI"  # succeeded but returned empty data
    REVERTED = "REVERTED"  # reverted
    MISSING = "MISSING"  # transport dropped it (batch failure, timeout)


@dataclass(frozen=True, slots=True)
class Answer:
    status: Status
    data: bytes = b""
    message: str = ""  # revert reason, when the transport could recover one

    @property
    def ok(self) -> bool:
        return self.status is Status.VALUE

    def uint(self) -> int:
        if not self.ok:
            raise ValueError(f"no value: {self.status.value}")
        return int.from_bytes(self.data[:32], "big")

    def uint_or(self, default: int | None = None) -> int | None:
        return self.uint() if self.ok else default


@dataclass(frozen=True, slots=True)
class Call:
    to: str
    data: bytes
    gas_hint: int = 80_000  # measured median get_dy is ~73k; see docs E3


@runtime_checkable
class Transport(Protocol):
    """Read-only chain access at a pinned block."""

    @property
    def block(self) -> int: ...

    @property
    def chain_id(self) -> int: ...

    def call(self, to: str, data: bytes, *, overrides: dict | None = None) -> bytes:
        """One eth_call at the pinned block.  Raises on revert."""
        ...

    def call_many(self, calls: list[Call], *, overrides: dict | None = None) -> list[Answer]:
        """Many eth_calls at the pinned block, batched however the transport likes.

        Must return one Answer per input call, in order, and must never raise
        for a per-call failure -- that is what `Status` is for.
        """
        ...


def run_batch(
    transport, requests: list[bytes], to: str, overrides: dict | None = None
) -> list[bytes | None]:
    """Issue independent calls to one address, concurrently if the transport can.

    The chunks a batch splits into do not depend on one another, and saying so
    is the only portable way to let a transport exploit it: a Python one uses
    threads, a browser one `Promise.all`, and one with neither runs the loop.
    Deciding that inside `core` would bake a threading model into the part that
    has to run in a Web Worker.

    Distinct from `Transport.call_many`, which means JSON-RPC *batching* -- many
    calls inside one HTTP request, and so one stream.  Measured over a 1.2 Mbps
    uplink, three independent 600-probe chunks took 3,979 ms in sequence and
    2,334 ms issued at once; the 1.70x comes from using more than one stream.

    An entry is `None` where that call raised, so the caller can fall back to
    its own splitting rather than lose the whole batch.
    """
    runner = getattr(transport, "call_batch", None)
    if runner is not None:
        return runner(requests, to=to, overrides=overrides)
    out: list[bytes | None] = []
    for data in requests:
        try:
            out.append(transport.call(to, data, overrides=overrides))
        except Exception:
            out.append(None)
    return out
