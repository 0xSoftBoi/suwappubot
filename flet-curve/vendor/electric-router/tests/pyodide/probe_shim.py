"""Every entry point of `erouter.wasm`, exercised inside a real Pyodide.

Run by `tests/js/pyodide_harness.mjs`, which loads Pyodide in node, copies
`src/erouter` into its filesystem, initialises the wasm module and hands this
file to `runPythonAsync`.  One line per entry point; anything not starting
with `OK` is a failure, and `tests/test_pyodide_shim.py` reads them back.

The point is the *differences*.  This shim is the one part of the tree that
only ever runs where CPython is not, so a CPython test of it proves nothing
about the place it runs -- `JsBuffer` has `to_bytes` and no `destroy`, and
that alone broke three of these eight while everything else stayed green.
"""
import sys
import traceback

# `erouter_wasm_glue` is the initialised wasm module, registered by the
# harness; the package comes from the filesystem it copied it into.
import erouter_wasm_glue as glue
import numpy as np

from erouter.wasm import _evm, _solve

_solve.bind(glue)
_evm.bind(glue)
sys.modules["erouter_solve"] = _solve
sys.modules["erouter_evm"] = _evm

report = []
def step(name, fn):
    try:
        report.append(f"OK   {name}: {fn()}")
    except Exception as exc:
        report.append(f"FAIL {name}: {type(exc).__name__}: {exc}\n"
                      + "".join(traceback.format_exc().splitlines(True)[-6:]))

step("version", lambda: _solve.version())

def solve_once():
    p = _solve.Problem([0, 0], [1, 1], [1.0, 2.0], [1e-4, 2e-4],
                       [float("inf")] * 2, 2)
    try:
        got = p.solve(0, 1, 1.0)
        return {k: (len(v) if isinstance(v, bytes) else v)
                for k, v in got.items() if k in ("psi", "pivots", "feasible", "reason")}
    finally:
        p.close()
step("Problem.solve", solve_once)

step("cancel_cycles", lambda: _solve.cancel_cycles([0, 1, 2], [1, 2, 0],
                                                   [1.0, 1.0, 1.0], 1e-12, 3))
step("find_cycle", lambda: _solve.find_cycle([0, 1, 2], [1, 2, 0], 3))

def calibrate_once():
    deltas = np.geomspace(1e2, 1e6, 7)
    quotes = deltas * (1 - 1e-4 - deltas * 2e-10)
    return _solve.calibrate(deltas.tolist(), quotes.tolist())[:3]
step("calibrate", calibrate_once)

def shortest():
    p = _solve.Problem([0, 0, 1], [1, 2, 2], [1.0, 1.0, 1.0],
                       [1e-4, 3e-4, 1e-4], [float("inf")] * 3, 3)
    try:
        return p.shortest_path(0, 2)
    finally:
        p.close()
step("shortest_path", shortest)

def evm_once():
    evm = _evm.Evm("Osaka", 1)
    evm.set_block(number=1, timestamp=1_770_000_000)
    who = "0x" + "22" * 20
    evm.insert_account(who, code=bytes.fromhex("602a5f5260205ff3"))
    got = evm.call("0x" + "11" * 20, who, b"")
    return int.from_bytes(got["output"], "big"), got["gas_used"]
step("Evm.call", evm_once)

def evm_batch():
    evm = _evm.Evm("Osaka", 1)
    evm.set_block(number=1, timestamp=1_770_000_000)
    who = "0x" + "44" * 20
    evm.insert_account(who, code=bytes.fromhex("6007545f5260205ff3"))
    evm.insert_storage_many([(who, "0x7", "0x1234")])
    out = evm.call_many("0x" + "11" * 20, [(who, b""), (who, b"")])
    return [int.from_bytes(o["output"], "big") for o in out], evm.take_misses()
step("Evm.call_many + misses", evm_batch)

def split():
    # `slope` is one shorter than `x` and `u` -- it is `diff(u) / diff(x)`.
    # Equal-length arrays here passed while the real thing overran its own
    # flattened array on every quote, which is the whole reason this probe
    # uses a shape the router actually produces.
    x = [0.0, 0.5, 1.0]
    u = [0.0, 0.5, 0.99]
    slope = [1.0, 0.98]
    return _solve.split_ascend(
        [(x, u, slope, 1.0, 0.0)],
        [0], [1], [None], [[0]], [0], 2, 1, 1.0, [[1.0]], [(0, 0)],
        1e-6, 10, 2, 0.3, 1e-9)
step("split_ascend", split)

"\n".join(report)
