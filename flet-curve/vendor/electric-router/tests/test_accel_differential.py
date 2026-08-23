"""The Rust solve must be the Python solve, and both must be optimal.

Two comparisons, answering different questions:

* **against Python** -- the port has to reproduce the reference, including which
  of several optimal bases it reaches, because a quote must be the same answer in
  CPython, in Pyodide and in a Web Worker.  Tie-breaking is part of the contract:
  steepest-edge ties go to the lowest index, matching numpy's `argmax`.
* **against OSQP** -- which shares no code with either, so it can catch a mistake
  the port faithfully copied from the original (§13.3).

Skipped, not failed, when the extension is absent: `erouter.core` is required to
work without it.
"""

from __future__ import annotations

import numpy as np
import pytest

from erouter.core import graph
from erouter.core.accel import available, solve_arrays
from erouter.core.solve import TOL, active_set_solve

pytestmark = pytest.mark.skipif(not available(), reason="erouter_solve not installed")


def make(tau, sig, a, B, *, cap=None, Psi=1.0, n=None):
    tau = np.asarray(tau, np.int64)
    sig = np.asarray(sig, np.int64)
    n = n or int(max(tau.max(), sig.max()) + 1)
    return graph.build(tau, sig, np.asarray(a, float), np.asarray(B, float),
                       np.ones(n), Psi, cap=cap, n_nodes=n, merge_duplicates=False)


def rust(g, src, dst, Psi, **kw):
    out = solve_arrays(
        g, src, dst, Psi,
        tol=kw.get("tol", TOL), maxit=kw.get("maxit", 600),
        min_flow=kw.get("min_flow", 0.0), gas_cost=kw.get("gas_cost", 0.0),
        partial_ok=kw.get("partial_ok", False),
        a0=kw.get("a0"), forbidden=kw.get("forbidden"), pinned=kw.get("pinned"),
    )
    assert out is not None
    return out


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
def test_the_port_reproduces_the_reference(name):
    spec = dict(CASES[name])
    Psi = spec.pop("Psi")
    g = make(Psi=Psi, **spec)
    dst = int(max(g.tau.max(), g.sig.max()))

    ours = active_set_solve(g, 0, dst, Psi)
    theirs = rust(g, 0, dst, Psi)

    assert theirs["feasible"] == ours.feasible, f"{name}: feasibility differs"
    assert np.allclose(theirs["psi"], ours.psi, atol=1e-12, rtol=0), (
        f"{name}: flows differ by {np.max(np.abs(np.array(theirs['psi']) - ours.psi)):.3e}"
    )


@pytest.mark.parametrize("name", list(CASES))
def test_the_port_is_optimal_against_osqp(name):
    """Catches anything the port copied faithfully from a wrong original."""
    pytest.importorskip("osqp")
    from test_solve_differential import objective, reference

    spec = dict(CASES[name])
    Psi = spec.pop("Psi")
    g = make(Psi=Psi, **spec)
    dst = int(max(g.tau.max(), g.sig.max()))

    theirs = np.asarray(rust(g, 0, dst, Psi)["psi"], float)
    mine = objective(g, theirs)
    ref, _ = reference(g, 0, dst, Psi)
    assert abs(mine - ref) <= 1e-9 * Psi, (
        f"{name}: the Rust flow is off by {(mine - ref) / Psi * 1e4:.6f} bp"
    )


def test_a_pin_is_honoured_the_same_way():
    g = make([0, 0], [1, 1], [1.0, 1.0], [1.0, 1.0], Psi=1.0)
    ours = active_set_solve(g, 0, 1, 1.0, forced_upper={0: 0.3})
    theirs = rust(g, 0, 1, 1.0, pinned={0: 0.3})
    assert np.allclose(theirs["psi"], ours.psi, atol=1e-12)
    assert abs(theirs["psi"][0] - 0.3) < 1e-12


def test_a_forbidden_arc_is_refused_the_same_way():
    g = make([0, 0], [1, 1], [1.0, 0.999], [1.0, 1.0], Psi=1.0)
    forbid = np.array([True, False])
    ours = active_set_solve(g, 0, 1, 1.0, forbidden=forbid)
    theirs = rust(g, 0, 1, 1.0, forbidden=forbid)
    assert theirs["psi"][0] == 0.0 and ours.psi[0] == 0.0
    assert np.allclose(theirs["psi"], ours.psi, atol=1e-12)


@pytest.mark.parametrize("seed", range(12))
def test_random_graphs_agree(seed):
    """Fuzz: the shapes a hand-written case list does not think of."""
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
    dst = n - 1
    ours = active_set_solve(g, 0, dst, 1.0)
    theirs = rust(g, 0, dst, 1.0)
    assert theirs["feasible"] == ours.feasible, "feasibility differs"
    if ours.feasible:
        assert np.allclose(theirs["psi"], ours.psi, atol=1e-9), (
            f"seed {seed}: max |dpsi| "
            f"{np.max(np.abs(np.array(theirs['psi']) - ours.psi)):.3e}"
        )


# --------------------------------------------------------- the hard paths
#
# Everything above converges in a handful of pivots, which is what a hand-written
# case list produces and what the interesting code never runs.  A real $20M quote
# reaches `maxit`, cycles under Bland's rule and returns PARTIAL; the port
# disagreed with the reference on all three while passing every test above.


def crowded(n_lanes=14, seed=3):
    """Many near-identical lanes: the shape that makes a solve oscillate.

    With `eps` clustered within a hair of each other, arcs enter and leave the
    basis in turn, each carrying dust -- which is what the degeneracy screen
    and Bland's rule exist for, and what a two-arc test cannot produce.
    """
    rng = np.random.default_rng(seed)
    tau = np.zeros(n_lanes, np.int64)
    sig = np.ones(n_lanes, np.int64)
    a = 1.0 - rng.random(n_lanes) * 1e-9      # all but identical
    B = 1.0 + rng.random(n_lanes) * 1e-9
    return make(tau, sig, a, B, Psi=1.0, n=2)


@pytest.mark.parametrize("maxit", [1, 2, 3, 5, 11])
def test_running_out_of_pivots_agrees(maxit):
    """`maxit` exhaustion: same verdict, same flow, same words."""
    g = crowded()
    ours = active_set_solve(g, 0, 1, 1.0, maxit=maxit)
    theirs = rust(g, 0, 1, 1.0, maxit=maxit)
    assert theirs["feasible"] == ours.feasible, (
        f"maxit={maxit}: feasible {theirs['feasible']} vs {ours.feasible}"
    )
    assert theirs["reason"] == ours.reason, (
        f"maxit={maxit}: {theirs['reason']!r} vs {ours.reason!r}"
    )
    assert np.allclose(theirs["psi"], ours.psi, atol=1e-12)


@pytest.mark.parametrize("maxit", [1, 2, 3, 5, 11])
def test_an_unconverged_flow_agrees_when_the_caller_accepts_one(maxit):
    """`partial_ok`: the incumbent is handed over, and must be the same one."""
    g = crowded()
    ours = active_set_solve(g, 0, 1, 1.0, maxit=maxit, partial_ok=True)
    theirs = rust(g, 0, 1, 1.0, maxit=maxit, partial_ok=True)
    assert theirs["feasible"] == ours.feasible
    assert theirs["reason"] == ours.reason
    assert np.allclose(theirs["psi"], ours.psi, atol=1e-12), (
        f"maxit={maxit}: max |dpsi| "
        f"{np.max(np.abs(np.array(theirs['psi']) - ours.psi)):.3e}"
    )


@pytest.mark.parametrize("seed", range(6))
def test_cycling_agrees(seed):
    """Bland's rule and the cycle counter have to fire in step."""
    g = crowded(n_lanes=20, seed=seed)
    ours = active_set_solve(g, 0, 1, 1.0, maxit=40, partial_ok=True)
    theirs = rust(g, 0, 1, 1.0, maxit=40, partial_ok=True)
    assert theirs["reason"] == ours.reason, (
        f"seed {seed}: {theirs['reason']!r} vs {ours.reason!r}"
    )
    assert np.allclose(theirs["psi"], ours.psi, atol=1e-12)


@pytest.mark.parametrize("screen", [0.0, 1e-3, 1e-2, 0.1])
def test_the_flow_screen_agrees(screen):
    """`min_flow` refuses entry below a floor; both must refuse the same arcs."""
    g = crowded()
    ours = active_set_solve(g, 0, 1, 1.0, min_flow=screen)
    theirs = rust(g, 0, 1, 1.0, min_flow=screen)
    assert theirs["feasible"] == ours.feasible
    assert np.allclose(theirs["psi"], ours.psi, atol=1e-12)


@pytest.mark.parametrize("gas", [0.0, 1e-6, 1e-4, 1e-2])
def test_the_gas_screen_agrees(gas):
    """§11.1: an arc must beat the gas of one more leg to be admitted."""
    g = crowded()
    ours = active_set_solve(g, 0, 1, 1.0, gas_cost=gas)
    theirs = rust(g, 0, 1, 1.0, gas_cost=gas)
    assert theirs["feasible"] == ours.feasible
    assert np.allclose(theirs["psi"], ours.psi, atol=1e-12)


@pytest.mark.skipif(not available(), reason="the Rust solver is not installed")
def test_a_warm_start_of_indices_is_the_same_warm_start():
    """`A0` may be indices, and `Solution.active` is exactly that.

    The bridge used to run `np.asarray(a0, bool)` over it, which maps `[3, 17]`
    to `[True, True]` -- a mask over the wrong arcs and the wrong length.  The
    Rust solve then started from a basis the Python solve never chose, and every
    real-graph comparison was measuring that rather than the port: of 54 problems
    taken off a live quote, only 8 agreed on the pivot count.
    """
    g = crowded()
    cold = active_set_solve(g, 0, 1, 1.0)
    warm = cold.active                      # indices, not a mask
    assert warm.dtype.kind in "iu", "the pipeline warm-starts from indices"

    want = active_set_solve(g, 0, 1, 1.0, A0=warm)
    got = rust(g, 0, 1, 1.0, a0=warm)
    assert got["pivots"] == want.pivots
    assert np.allclose(np.asarray(got["psi"]), want.psi, rtol=0, atol=1e-12)
