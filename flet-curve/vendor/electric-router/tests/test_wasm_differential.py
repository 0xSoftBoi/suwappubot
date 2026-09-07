"""The wasm module must be the native extension, byte for byte.

Same crate, same compiler version (`rust/rust-toolchain.toml` pins it), two
targets.  The solver's only non-trivially-rounded operation is `sqrt`, which
IEEE-754 requires be correctly rounded everywhere, and Rust never contracts a
multiply-add on its own -- so an exact match is the expectation, not a hope.
Anything else is a marshalling bug, which is precisely what this catches: the
wasm boundary passes typed arrays where PyO3 passes lists, and flattens the
ragged inputs that PyO3 hands over as nested sequences.

Skipped when either half is missing.  `scripts/build_wasm.sh` makes the wasm
one; `maturin develop -m rust/Cargo.toml` makes the native one.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import numpy as np
import pytest

from erouter.core import graph
from erouter.core.accel import available
from erouter.core.solve import TOL

ROOT = Path(__file__).resolve().parents[1]
HARNESS = ROOT / "tests" / "js" / "solver_harness.mjs"
PKG = ROOT / "rust" / "wasm" / "pkg"
NODE = shutil.which("node")

pytestmark = [
    pytest.mark.skipif(not available(), reason="erouter_solve not installed"),
    pytest.mark.skipif(NODE is None, reason="node is not installed"),
    pytest.mark.skipif(
        not (PKG / "erouter_wasm_bg.wasm").exists(),
        reason="run scripts/build_wasm.sh",
    ),
]


def run(job: dict) -> dict:
    """One job through the wasm module, as the browser would run it."""
    done = subprocess.run(
        [NODE, str(HARNESS), str(PKG)],
        input=json.dumps(job),
        capture_output=True,
        text=True,
        timeout=120,
    )
    if done.returncode != 0:
        raise AssertionError(f"harness failed:\n{done.stderr}")
    return json.loads(done.stdout)


def floats(hexed: str) -> np.ndarray:
    return np.frombuffer(bytes.fromhex(hexed), dtype=np.float64)


def flags(hexed: str) -> np.ndarray:
    return np.frombuffer(bytes.fromhex(hexed), dtype=np.uint8).astype(bool)


def make(tau, sig, a, B, *, cap=None, Psi=1.0, n=None):
    tau = np.asarray(tau, np.int64)
    sig = np.asarray(sig, np.int64)
    n = n or int(max(tau.max(), sig.max()) + 1)
    return graph.build(tau, sig, np.asarray(a, float), np.asarray(B, float),
                       np.ones(n), Psi, cap=cap, n_nodes=n, merge_duplicates=False)


def as_job(g, src, dst, psi_total, **kw) -> dict:
    caps = np.asarray(g.cap, float)
    return {
        "op": "solve",
        "tau": np.asarray(g.tau, np.int64).tolist(),
        "sig": np.asarray(g.sig, np.int64).tolist(),
        "g": np.asarray(g.G, float).tolist(),
        "eps": np.asarray(g.eps, float).tolist(),
        # JSON has no infinity; `null` carries it and the harness restores it.
        "cap": [None if not np.isfinite(v) else float(v) for v in caps],
        "n_nodes": int(g.n_nodes),
        "src": int(src),
        "dst": int(dst),
        "psi_total": float(psi_total),
        "a0": kw.get("a0"),
        "forbidden": kw.get("forbidden"),
        "pinned": kw.get("pinned"),
        "tol": kw.get("tol", TOL),
        "maxit": kw.get("maxit", 600),
        "min_flow": kw.get("min_flow", 0.0),
        "gas_cost": kw.get("gas_cost", 0.0),
        "partial_ok": kw.get("partial_ok", False),
        "rank1": kw.get("rank1", True),
    }


def both(g, src, dst, psi_total, **kw):
    """The native answer and the wasm one, ready to compare."""
    import erouter_solve

    caps = np.asarray(g.cap, float)
    problem = erouter_solve.Problem(
        np.asarray(g.tau, np.int64).tolist(),
        np.asarray(g.sig, np.int64).tolist(),
        np.asarray(g.G, float).tolist(),
        np.asarray(g.eps, float).tolist(),
        [float(v) if np.isfinite(v) else float("inf") for v in caps],
        int(g.n_nodes),
    )
    native = problem.solve(
        src=int(src), dst=int(dst), psi_total=float(psi_total),
        a0=None if kw.get("a0") is None else [bool(v) for v in kw["a0"]],
        forbidden=None if kw.get("forbidden") is None
        else [bool(v) for v in kw["forbidden"]],
        pinned=kw.get("pinned"),
        tol=kw.get("tol", TOL), maxit=kw.get("maxit", 600),
        min_flow=kw.get("min_flow", 0.0), gas_cost=kw.get("gas_cost", 0.0),
        partial_ok=kw.get("partial_ok", False), rank1=kw.get("rank1", True),
    )
    return native, run(as_job(g, src, dst, psi_total, **kw))


def same_solve(native, wasm, where: str = "") -> None:
    for key, js in (("psi", "psi"), ("u", "u"),
                    ("psi_upper", "psiUpper"), ("rho", "rho")):
        mine = np.frombuffer(native[key], dtype=np.float64)
        theirs = floats(wasm[js])
        assert mine.tobytes() == theirs.tobytes(), (
            f"{where}{key} differs: max |d| "
            f"{np.max(np.abs(mine - theirs)) if mine.size else 0:.3e}"
        )
    for key, js in (("active", "active"), ("upper", "upper")):
        assert bytes(native[key]) == bytes.fromhex(wasm[js]), f"{where}{key} differs"
    for key, js in (("pivots", "pivots"), ("chol_failures", "cholFailures"),
                    ("keep_changes", "keepChanges"), ("refits", "refits"),
                    ("feasible", "feasible"), ("reason", "reason")):
        assert native[key] == wasm[js], (
            f"{where}{key}: {native[key]!r} native, {wasm[js]!r} wasm"
        )


CASES = {
    "one arc": {"tau": [0], "sig": [1], "a": [1.0], "B": [1.0], "Psi": 0.25},
    "parallel": {"tau": [0, 0], "sig": [1, 1], "a": [1.0, 1.0], "B": [1.0, 2.0], "Psi": 1.0},
    "diode": {"tau": [0, 0], "sig": [1, 1], "a": [1.0, 0.9999], "B": [1.0, 1.0], "Psi": 0.5},
    "series": {"tau": [0, 0, 1], "sig": [2, 1, 2], "a": [0.997, 0.9995, 0.9995],
               "B": [1.0, 1.0, 1.0], "Psi": 0.4},
    "capped": {"tau": [0, 0], "sig": [1, 1], "a": [1.0, 0.999], "B": [1.0, 1.0],
               "cap": [0.2, np.inf], "Psi": 1.0},
    "network": {"tau": [0, 0, 1, 2, 0], "sig": [1, 2, 3, 3, 3],
                "a": [0.9995, 0.9990, 0.9995, 0.9998, 0.996],
                "B": [1.0, 2.0, 1.0, 3.0, 0.5], "Psi": 2.0},
}


@pytest.mark.parametrize("name", list(CASES))
def test_the_shaped_problems_agree(name):
    spec = dict(CASES[name])
    Psi = spec.pop("Psi")
    g = make(**spec, Psi=Psi)
    dst = int(max(np.max(g.tau), np.max(g.sig)))
    same_solve(*both(g, 0, dst, Psi), where=f"{name}: ")


@pytest.mark.parametrize("seed", range(12))
def test_random_graphs_agree(seed):
    rng = np.random.default_rng(seed)
    n = int(rng.integers(3, 7))
    m = int(rng.integers(n, 3 * n))
    tau = rng.integers(0, n, m)
    sig = rng.integers(0, n, m)
    keep = tau != sig
    tau, sig, m = tau[keep], sig[keep], int(keep.sum())
    if m < 2:
        pytest.skip("degenerate draw")
    a = 1.0 - rng.random(m) * 1e-3
    B = 0.5 + rng.random(m) * 3.0
    g = make(tau, sig, a, B, Psi=1.0, n=n)
    same_solve(*both(g, 0, n - 1, 1.0), where=f"seed {seed}: ")


def crowded(n_lanes=14, seed=3):
    """Many near-identical lanes -- the shape that makes a solve oscillate.

    The one that matters here.  `rust/README.md` records a port that agreed on
    every clean problem and returned 4,681 WETH where the reference returned
    9,052 on a real quote, because the real quote reached `maxit` and cycled.
    """
    rng = np.random.default_rng(seed)
    tau = np.zeros(n_lanes, np.int64)
    sig = np.ones(n_lanes, np.int64)
    a = 1.0 - rng.random(n_lanes) * 1e-9
    B = 1.0 + rng.random(n_lanes) * 1e-9
    return make(tau, sig, a, B, Psi=1.0, n=2)


@pytest.mark.parametrize("maxit", [1, 2, 3, 5, 11])
def test_running_out_of_pivots_agrees(maxit):
    same_solve(*both(crowded(), 0, 1, 1.0, maxit=maxit), where=f"maxit {maxit}: ")


@pytest.mark.parametrize("maxit", [1, 2, 3, 5, 11])
def test_a_partial_answer_agrees(maxit):
    same_solve(*both(crowded(), 0, 1, 1.0, maxit=maxit, partial_ok=True),
               where=f"maxit {maxit}: ")


@pytest.mark.parametrize("seed", range(6))
def test_cycling_agrees(seed):
    same_solve(*both(crowded(n_lanes=20, seed=seed), 0, 1, 1.0,
                     maxit=40, partial_ok=True), where=f"seed {seed}: ")


@pytest.mark.parametrize("screen", [0.0, 1e-3, 1e-2, 0.1])
def test_the_flow_screen_agrees(screen):
    same_solve(*both(crowded(), 0, 1, 1.0, min_flow=screen), where=f"min_flow {screen}: ")


@pytest.mark.parametrize("gas", [0.0, 1e-6, 1e-4, 1e-2])
def test_the_gas_screen_agrees(gas):
    same_solve(*both(crowded(), 0, 1, 1.0, gas_cost=gas), where=f"gas {gas}: ")


def test_a_pin_is_honoured_the_same_way():
    g = make([0, 0], [1, 1], [1.0, 0.999], [1.0, 1.0], Psi=1.0)
    same_solve(*both(g, 0, 1, 1.0, pinned=[(1, 0.3)]))


def test_a_forbidden_arc_is_refused_the_same_way():
    g = make([0, 0], [1, 1], [1.0, 0.999], [1.0, 1.0], Psi=1.0)
    same_solve(*both(g, 0, 1, 1.0, forbidden=[False, True]))


def test_a_warm_start_crosses_the_same_way():
    g = crowded()
    same_solve(*both(g, 0, 1, 1.0, a0=[True] + [False] * 13))


# ------------------------------------------------------------- calibrate


def ladder(seed: int):
    rng = np.random.default_rng(seed)
    deltas = np.geomspace(1e2, 1e6, 7)
    # A concave curve with a little noise: what a probe grid looks like.
    quotes = deltas * (1.0 - 1e-4 - deltas * 2e-10) * (1 + rng.normal(0, 1e-9, 7))
    return deltas.tolist(), quotes.tolist()


@pytest.mark.parametrize("seed", range(6))
def test_calibrate_agrees(seed):
    import erouter_solve

    deltas, quotes = ladder(seed)
    native = erouter_solve.calibrate(deltas, quotes, None, False, 0.05, None, None, 0.0)
    wasm = run({
        "op": "calibrate", "deltas": deltas, "quotes": quotes, "delta_bar": None,
        "structural_flag": False, "drift_tol": 0.05, "cap": None,
        "f_at_cap": None, "quantum": 0.0,
    })
    for k, (key, js) in enumerate([("a", "a"), ("B", "b"), ("cap", "cap")]):
        assert np.float64(native[k]).tobytes() == bytes.fromhex(wasm[js]), (
            f"seed {seed}: {key} differs -- {native[k]!r} vs {floats(wasm[js])[0]!r}"
        )
    assert native[3] == wasm["clamped"]
    assert native[4] == wasm["convexFlag"]
    assert native[5] == wasm["flag"]
    for k, js in ((6, "drift"), (7, "eta"), (9, "calibDelta"), (10, "tangentDelta")):
        assert np.float64(native[k]).tobytes() == bytes.fromhex(wasm[js]), (
            f"seed {seed}: field {k} differs"
        )
    assert native[8] == wasm["splitHint"]
    assert native[11] == wasm["note"]


# ---------------------------------------------------------- cycles, paths


@pytest.mark.parametrize("seed", range(6))
def test_cancel_cycles_agrees(seed):
    import erouter_solve

    rng = np.random.default_rng(seed)
    n = 5
    tau = [0, 1, 2, 3, 4, 2]
    sig = [1, 2, 3, 4, 0, 0]
    psi = (rng.random(len(tau)) + 0.1).tolist()
    flow, removed = erouter_solve.cancel_cycles(
        [int(v) for v in tau], [int(v) for v in sig], psi, 1e-12, n)
    wasm = run({"op": "cancel_cycles", "tau": tau, "sig": sig, "psi": psi,
                "tol": 1e-12, "n_nodes": n})
    assert np.asarray(flow, float).tobytes() == floats(wasm["flow"]).tobytes()
    assert removed == wasm["removed"]


def test_find_cycle_agrees():
    import erouter_solve

    tau, sig = [0, 1, 2], [1, 2, 0]
    native = erouter_solve.find_cycle(tau, sig, 3)
    wasm = run({"op": "find_cycle", "tau": tau, "sig": sig, "n_nodes": 3})
    assert list(native or []) == wasm["arcs"]


def test_shortest_path_agrees():
    import erouter_solve

    g = make([0, 0, 1, 2, 0], [1, 2, 3, 3, 3],
             [0.9995, 0.9990, 0.9995, 0.9998, 0.996],
             [1.0, 2.0, 1.0, 3.0, 0.5], Psi=2.0)
    caps = np.asarray(g.cap, float)
    problem = erouter_solve.Problem(
        np.asarray(g.tau, np.int64).tolist(), np.asarray(g.sig, np.int64).tolist(),
        np.asarray(g.G, float).tolist(), np.asarray(g.eps, float).tolist(),
        [float(v) if np.isfinite(v) else float("inf") for v in caps], int(g.n_nodes),
    )
    native = problem.shortest_path(0, 3, None, None, None, 8)
    wasm = run({
        "op": "shortest_path",
        "tau": np.asarray(g.tau, np.int64).tolist(),
        "sig": np.asarray(g.sig, np.int64).tolist(),
        "g": np.asarray(g.G, float).tolist(),
        "eps": np.asarray(g.eps, float).tolist(),
        "cap": [None if not np.isfinite(v) else float(v) for v in caps],
        "n_nodes": int(g.n_nodes), "src": 0, "dst": 3, "max_hops": 8,
    })
    assert list(native["arcs"]) == wasm["arcs"]
    assert native["found"] == wasm["found"]
    assert np.float64(native["length"]).tobytes() == bytes.fromhex(wasm["length"])
    assert list(native["negative_cycle"]) == wasm["negativeCycle"]
