"""The compiled circulation removal against the reference.

Which cycle is found is not an implementation detail: `cancel_cycles` takes
the minimum flow on whatever cycle comes back, so a different cycle is a
different flow and a different route.  The peel order and both tie-breaks --
the lowest arc index out of each node, and the arc the walk starts from -- have
to be reproduced, not merely a cycle found.
"""

from __future__ import annotations

import numpy as np
import pytest

from erouter.core import accel
from erouter.core.realize import _find_cycle, cancel_cycles

pytestmark = pytest.mark.skipif(
    not accel.available(), reason="the Rust pass is not installed")


def rust(tau, sig, psi, tol=1e-12):
    got = accel.cancel_cycles(np.asarray(tau, np.int64), np.asarray(sig, np.int64),
                              np.asarray(psi, float), tol)
    assert got is not None
    return got


CASES = {
    "a plain path": ([0, 1], [1, 2], [1.0, 1.0]),
    "a two cycle": ([0, 1], [1, 0], [1.0, 1.0]),
    "a loop off a path": ([0, 1, 2], [1, 2, 1], [2.0, 1.0, 1.0]),
    "two loops": ([0, 1, 2, 3], [1, 0, 3, 2], [1.0, 1.0, 2.0, 2.0]),
    "unequal loop": ([0, 1, 2], [1, 2, 0], [3.0, 1.0, 2.0]),
    "a reverse flow": ([0, 1], [1, 2], [1.0, -0.13]),
    "dust below tol": ([0, 1], [1, 0], [1e-15, 1e-15]),
    "nothing flowing": ([0, 1], [1, 0], [0.0, 0.0]),
}


@pytest.mark.parametrize("name", sorted(CASES))
def test_the_port_reproduces_the_reference(name):
    tau, sig, psi = CASES[name]
    want_flow, want_n = cancel_cycles(np.asarray(tau, np.int64),
                                      np.asarray(sig, np.int64),
                                      np.asarray(psi, float))
    got_flow, got_n = rust(tau, sig, psi)
    assert got_n == want_n, "a different number of cycles came out"
    assert np.allclose(got_flow, want_flow, rtol=0, atol=0), name


@pytest.mark.parametrize("seed", range(40))
def test_random_flows_agree(seed):
    """Flows with circulation in them, including reverse-direction arcs."""
    rng = np.random.default_rng(seed)
    n = int(rng.integers(3, 10))
    m = int(rng.integers(n, 3 * n))
    tau = rng.integers(0, n, m).astype(np.int64)
    sig = rng.integers(0, n, m).astype(np.int64)
    keep = tau != sig
    tau, sig = tau[keep], sig[keep]
    if len(tau) < 2:
        pytest.skip("degenerate draw")
    psi = rng.random(len(tau))
    if rng.random() < 0.3:                     # some arcs run backwards
        psi[rng.integers(0, len(psi))] *= -1
    if rng.random() < 0.3:                     # some are dust
        psi[rng.integers(0, len(psi))] = 1e-15
    want_flow, want_n = cancel_cycles(tau, sig, psi)
    got_flow, got_n = rust(tau, sig, psi)
    assert got_n == want_n
    assert np.allclose(got_flow, want_flow, rtol=0, atol=0)


@pytest.mark.parametrize("seed", range(12))
def test_the_cycle_itself_is_the_same_one(seed):
    """Not just *a* cycle -- the same one, or the cancelled flow differs."""
    rng = np.random.default_rng(1000 + seed)
    n = int(rng.integers(3, 9))
    tau = rng.integers(0, n, 3 * n).astype(np.int64)
    sig = rng.integers(0, n, 3 * n).astype(np.int64)
    keep = tau != sig
    tau, sig = tau[keep], sig[keep]
    if len(tau) < 2:
        pytest.skip("degenerate draw")
    want = _find_cycle(tau, sig)
    got = accel._rust.find_cycle(tau.tolist(), sig.tolist(), int(n))
    if want is None:
        assert got is None
    else:
        assert list(got) == list(want)
