"""`erouter_evm`, served by the wasm module.

Method for method with `rust/evm/src/py.rs`, so `core.localevm` drives either
without asking which.  The two bindings already agree on the hard part --
addresses, slots and values are hex strings, code and calldata are bytes --
so this is mostly the shape of the *results*: PyO3 hands back dicts, and
wasm-bindgen hands back handles that have to be freed.
"""

from __future__ import annotations

_mod = None


def bind(module) -> None:
    global _mod
    _mod = module


__version__ = "wasm"

#: Enough for a probe batch of several hundred sub-calls in one `eth_call`.
#: Not a transaction, so EIP-7825's 16.7M cap does not apply -- the wrapper
#: lifts it, and this is the number that reaches it.
DEFAULT_GAS = 1_000_000_000


class Evm:
    """The state a quote reads, and the machine that reads it."""

    def __init__(self, spec: str = "Osaka", chain_id: int = 1):
        self._inner = _mod.Evm.new(spec, float(chain_id))

    def set_block(self, number, timestamp, basefee=0, gas_limit=30_000_000,
                  coinbase="0x" + "00" * 20, prevrandao="0x" + "00" * 32,
                  excess_blob_gas=None):
        self._inner.setBlock(
            float(number), float(timestamp), float(basefee), float(gas_limit),
            coinbase, prevrandao,
            None if excess_blob_gas is None else float(excess_blob_gas),
        )

    def insert_account(self, address, nonce=1, balance="0x0", code=None):
        from pyodide.ffi import to_js

        self._inner.insertAccount(
            address, float(nonce), balance,
            None if code is None else to_js(memoryview(bytes(code))),
        )

    def set_balance(self, address, balance):
        self._inner.setBalance(address, balance)

    def insert_storage(self, address, slot, value):
        self._inner.insertStorage(address, slot, value)

    def insert_storage_many(self, entries):
        """`[(address, slot, value), ...]` -- the sweep inserts thousands."""
        from pyodide.ffi import to_js

        rows = list(entries)
        self._inner.insertStorageMany(
            to_js([r[0] for r in rows]),
            to_js([r[1] for r in rows]),
            to_js([r[2] for r in rows]),
        )

    def insert_block_hash(self, number, hash_):
        self._inner.insertBlockHash(float(number), hash_)

    def has_account(self, address) -> bool:
        return bool(self._inner.hasAccount(address))

    def known_slots(self):
        flat = self._inner.knownSlots().to_py()
        return [(flat[k], flat[k + 1]) for k in range(0, len(flat), 2)]

    @property
    def slot_count(self) -> int:
        return int(self._inner.slotCount)

    @property
    def account_count(self) -> int:
        return int(self._inner.accountCount)

    def take_misses(self) -> dict:
        got = self._inner.takeMisses()
        try:
            flat = got.slots.to_py()
            return {
                "accounts": list(got.accounts.to_py()),
                "slots": [(flat[k], flat[k + 1]) for k in range(0, len(flat), 2)],
                "blocks": [int(v) for v in got.blocks.to_py()],
            }
        finally:
            got.free()

    def call(self, caller, to, data, value="0x0", gas_limit=DEFAULT_GAS) -> dict:
        from pyodide.ffi import to_js

        got = self._inner.call(
            caller, to, to_js(memoryview(bytes(data))), value, float(gas_limit),
        )
        try:
            return {
                "success": bool(got.success),
                "output": got.output.to_bytes(),
                "gas_used": int(got.gasUsed),
                "revert_reason": got.revertReason,
                "halt_reason": got.haltReason,
            }
        finally:
            got.free()

    def call_many(self, caller, calls, gas_limit=DEFAULT_GAS) -> list[dict]:
        """`[(to, calldata), ...]` in one crossing.

        A probe batch is hundreds of calls and each crossing costs; the
        calldata goes over flattened with offsets beside it, and the answers
        come back the same way.
        """
        from pyodide.ffi import to_js

        targets, blob, offsets = [], bytearray(), [0]
        for to, data in calls:
            targets.append(to)
            blob += bytes(data)
            offsets.append(len(blob))
        got = self._inner.callMany(
            caller, to_js(targets), to_js(memoryview(bytes(blob))),
            _u32(offsets), float(gas_limit),
        )
        try:
            output = got.output.to_bytes()
            bounds = got.offsets.to_py()
            success = got.success.to_bytes()
            halted = got.halted.to_bytes()
            gas = got.gasUsed.to_py()
            reasons = got.reasons.to_py()
            return [
                {
                    "success": bool(success[k]),
                    "output": output[bounds[k]:bounds[k + 1]],
                    "gas_used": int(gas[k]),
                    "revert_reason": None if halted[k] else (reasons[k] or ""),
                    "halt_reason": reasons[k] if halted[k] else None,
                }
                for k in range(len(targets))
            ]
        finally:
            got.free()


def _u32(values):
    import numpy as np
    from pyodide.ffi import to_js

    return to_js(memoryview(np.ascontiguousarray(values, dtype=np.uint32)))
