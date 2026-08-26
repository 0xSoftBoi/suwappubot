"""`erouter.wasm` has to work in Pyodide, so it is tested in Pyodide.

The shim stands in for the two compiled extensions in a browser, and it is
the one part of this tree that never runs under CPython at all.  Testing it
here would prove nothing about where it runs: `JsBuffer` has `to_bytes` and
no `destroy`, and calling `destroy` on one raised `AttributeError: destroy`
for every quote the browser tried, while every CPython test stayed green.

So node loads a real Pyodide -- the same distribution `flet publish` caches
and ships -- copies the package into its filesystem, initialises the wasm
module, and runs `tests/pyodide/probe_shim.py` against it.

Skipped when node, the wasm build or that distribution is absent.  It costs
about fifteen seconds, which is why it is one test rather than nine.
"""

from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
HARNESS = ROOT / "tests" / "js" / "pyodide_harness.mjs"
PROBE = ROOT / "tests" / "pyodide" / "probe_shim.py"
PKG = ROOT / "rust" / "wasm" / "pkg" / "erouter_wasm_bg.wasm"
NODE = shutil.which("node")

#: Where `flet publish` caches the runtime it bundles.  Overridable, because a
#: machine that builds the frontend elsewhere still has one.
DIST = Path(os.environ.get(
    "EROUTER_PYODIDE",
    Path.home() / ".flet" / "cache" / "pyodide" / "314.0.3",
))

pytestmark = [
    pytest.mark.skipif(NODE is None, reason="node is not installed"),
    pytest.mark.skipif(not PKG.exists(), reason="run scripts/build_wasm.sh"),
    pytest.mark.skipif(
        not (DIST / "pyodide.mjs").exists(),
        reason=f"no Pyodide distribution at {DIST}",
    ),
]


def test_every_entry_point_answers_under_pyodide():
    done = subprocess.run(
        [NODE, str(HARNESS), str(PROBE), str(DIST)],
        capture_output=True, text=True, timeout=600, cwd=ROOT,
    )
    assert done.returncode == 0, f"the harness failed:\n{done.stderr[-2000:]}"
    lines = [line for line in done.stdout.splitlines()
             if line.startswith(("OK ", "FAIL "))]
    assert lines, f"the probe printed nothing:\n{done.stdout[-2000:]}\n{done.stderr[-2000:]}"
    failed = [line for line in lines if line.startswith("FAIL")]
    assert not failed, "\n".join(failed)
    # Every entry point, not merely the ones that happened to run.
    named = {line.split(":", 1)[0].removeprefix("OK ").strip() for line in lines}
    assert named >= {
        "version", "Problem.solve", "cancel_cycles", "find_cycle", "calibrate",
        "shortest_path", "Evm.call", "Evm.call_many + misses", "split_ascend",
    }, named
