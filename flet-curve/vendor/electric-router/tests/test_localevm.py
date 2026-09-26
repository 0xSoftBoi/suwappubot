"""The miss loop: what makes a browser able to warm without an access list.

`dev/local_evm.py` asks `eth_createAccessList` which slots a call will touch.
The scoped drpc key does not serve it and a browser has no second endpoint, so
`chain/localevm.py` runs the discovery the other way round -- make the call,
ask what it read and could not find, fetch that, make the call again.

What both designs must never do is let an unread slot pass as a zero, because
a zero fee, rate or balance is a plausible number and the quote then succeeds
and is wrong.  That is what `unreadable` is for, and it is the last test here.
"""

from __future__ import annotations

import asyncio

import pytest

#: This repo has no asyncio plugin and one file is not a reason to add one, so
#: each coroutine gets a one-line sync wrapper that drives it.
from erouter.chain.localevm import LocalEvm, LocalEvmError
from erouter.core.evm import CALLER
from erouter.core.transport import Call, Status

erouter_evm = pytest.importorskip("erouter_evm")

#: PUSH1 7; SLOAD; PUSH0; MSTORE; PUSH1 32; PUSH0; RETURN
READS_SLOT_7 = bytes.fromhex("6007545f5260205ff3")
#: PUSH0; PUSH0; REVERT
REVERTS = bytes.fromhex("5f5ffd")
#: STOP -- succeeds, returns nothing, which is not the same as a revert.
RETURNS_NOTHING = bytes.fromhex("00")

POOL = "0x" + "44" * 20
OTHER = "0x" + "55" * 20
SILENT = "0x" + "66" * 20


class FakeRpc:
    """A chain that answers in batches, and counts what it was asked."""

    chain_id = 1
    batch_size = 100

    def __init__(self, code=None, storage=None, balances=None):
        self.code = code or {}
        self.storage = storage or {}
        self.balances = balances or {}
        self.requests: list[tuple[str, list]] = []
        self.batches = 0

    async def batch(self, requests):
        self.batches += 1
        self.requests.extend(requests)
        out = []
        for method, params in requests:
            if method == "eth_getCode":
                out.append("0x" + self.code.get(params[0].lower(), b"").hex())
            elif method == "eth_getStorageAt":
                key = (params[0].lower(), int(params[1], 16))
                out.append(f"0x{self.storage.get(key, 0):064x}")
            elif method == "eth_getBalance":
                out.append(f"0x{self.balances.get(params[0].lower(), 0):x}")
            else:
                out.append(RuntimeError(f"unexpected {method}"))
        return out

    async def call(self, method, params):
        got = await self.batch([(method, params)])
        return got[0]


def fresh(**kw) -> tuple[LocalEvm, object]:
    backend = erouter_evm.Evm("Osaka", 1)
    backend.set_block(number=23_900_000, timestamp=1_770_000_000)
    return LocalEvm(backend, 1, 23_900_000, **kw), backend


def test_a_call_that_reverts_raises_and_one_that_says_nothing_does_not():
    """`Status.WRONG_ABI` is not `Status.REVERTED`, and the difference is real.

    A Curve pool that does not implement a function returns empty data rather
    than reverting.  `decode_uint("0x") == 0`, so conflating them quotes real
    mainnet pools at zero.
    """
    evm, backend = fresh()
    backend.insert_account(POOL, code=READS_SLOT_7)
    backend.insert_account(OTHER, code=REVERTS)
    backend.insert_account(SILENT, code=RETURNS_NOTHING)

    assert len(evm.call(POOL, b"")) == 32
    with pytest.raises(LocalEvmError):
        evm.call(OTHER, b"")

    answers = evm.call_many([Call(POOL, b""), Call(OTHER, b""), Call(SILENT, b"")])
    assert [a.status for a in answers] == [
        Status.VALUE, Status.REVERTED, Status.WRONG_ABI]


def test_the_caller_is_funded_before_anything_asks():
    """Otherwise every call reports it as a missing account and the loop goes
    off to fetch an empty one."""
    evm, backend = fresh()
    backend.insert_account(POOL, code=READS_SLOT_7)
    evm.call(POOL, b"")
    assert CALLER not in evm.misses()["accounts"]


def test_fill_fetches_exactly_what_was_read_and_stops():
    asyncio.run(_test_fill_fetches_exactly_what_was_read_and_stops())


async def _test_fill_fetches_exactly_what_was_read_and_stops():
    evm, _backend = fresh()
    rpc = FakeRpc(code={POOL: READS_SLOT_7}, storage={(POOL, 7): 0x1234})

    def run():
        return evm.call_many([Call(POOL, b"")])

    got = await evm.fill(rpc, run)
    assert int.from_bytes(got[0].data, "big") == 0x1234
    assert evm.stats.complete, evm.stats.errors
    # Two rounds by construction: the account first, then the slot it reads.
    assert evm.stats.rounds >= 2
    asked = {(method, tuple(params[:2])) for method, params in rpc.requests}
    assert ("eth_getCode", (POOL, "latest")) in asked
    assert any(m == "eth_getStorageAt" for m, _ in asked)


def test_fill_prefers_the_committed_code_to_a_round_trip():
    asyncio.run(_test_fill_prefers_the_committed_code_to_a_round_trip())


async def _test_fill_prefers_the_committed_code_to_a_round_trip():
    """A pool's code cannot change, so `eth_getCode` for one is a round trip
    for a constant."""
    evm, _backend = fresh()
    rpc = FakeRpc(storage={(POOL, 7): 0x99})

    def run():
        return evm.call_many([Call(POOL, b"")])

    await evm.fill(rpc, run, code_for=lambda a: READS_SLOT_7 if a == POOL else None)
    assert not any(m == "eth_getCode" for m, _ in rpc.requests)
    assert evm.stats.complete


def test_a_slot_the_chain_will_not_serve_is_counted_not_swallowed():
    asyncio.run(_test_a_slot_the_chain_will_not_serve_is_counted_not_swallowed())


async def _test_a_slot_the_chain_will_not_serve_is_counted_not_swallowed():
    """The whole hazard in one test: an unread slot reads as zero."""
    evm, _backend = fresh()

    class Refuses(FakeRpc):
        async def batch(self, requests):
            out = await super().batch(requests)
            return [RuntimeError("declined") if m == "eth_getStorageAt" else v
                    for (m, _), v in zip(requests, out, strict=True)]

    rpc = Refuses(code={POOL: READS_SLOT_7})

    def run():
        return evm.call_many([Call(POOL, b"")])

    got = await evm.fill(rpc, run, rounds=3)
    assert int.from_bytes(got[0].data, "big") == 0, "an absent slot is a zero"
    assert not evm.stats.complete, "and the warm has to say so"
    assert evm.stats.unreadable >= 1
    assert any("unreadable" in note for note in evm.stats.errors)


def test_an_override_is_installed_once():
    """The quoter rides in as an `eth_call` code override on chains where it is
    not deployed; locally that is just an account with code."""
    evm, backend = fresh()
    scratch = "0x" + "5c" * 20
    overrides = {scratch: {"code": "0x" + READS_SLOT_7.hex()}}
    backend.insert_storage(scratch, "0x7", "0x5")
    assert int.from_bytes(evm.call(scratch, b"", overrides=overrides), "big") == 5
    # Installed once: a second call with the same overrides must not re-insert
    # (which would reset the account and lose the storage above).
    assert int.from_bytes(evm.call(scratch, b"", overrides=overrides), "big") == 5


def test_a_batch_is_split_at_the_limit():
    asyncio.run(_test_a_batch_is_split_at_the_limit())


async def _test_a_batch_is_split_at_the_limit():
    """Erigon refuses a batch over 100 and refuses the *whole* batch."""
    evm, _ = fresh()
    rpc = FakeRpc(code={POOL: READS_SLOT_7})
    wanted = [(POOL, k) for k in range(250)]
    await evm._fetch(rpc, {"accounts": [], "slots": wanted, "blocks": []},
                     block="latest")
    assert rpc.batches == 3, "250 slots is three batches of at most 100"
