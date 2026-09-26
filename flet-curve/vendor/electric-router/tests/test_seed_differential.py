"""The compiled search against the reference.

The seed decides how many column-generation rounds run, so a divergence here
does not merely cost time -- it changes which arcs the solver ever sees.  The
cases that matter are the ones a shortest path is usually spared: negative
arcs, negative cycles, banned spurs, and the hop cap.
"""

from __future__ import annotations

import numpy as np
import pytest

from erouter.core import accel, graph
from erouter.core.seed import ShortestPath, build_adjacency, spfa

pytestmark = pytest.mark.skipif(
    not accel.available(), reason="the Rust search is not installed")


def make(tau, sig, a, n=None):
    tau = np.asarray(tau, np.int64)
    sig = np.asarray(sig, np.int64)
    n = n or int(max(tau.max(), sig.max()) + 1)
    return graph.build(tau, sig, np.asarray(a, float), np.ones(len(tau)),
                       np.ones(n), 1.0, n_nodes=n, merge_duplicates=False)


def rust(g, src, dst, **kw):
    got = accel.shortest_path(g, src, dst, **kw)
    assert got is not None
    if got["negative_cycle"]:
        return ShortestPath(negative_cycle=list(got["negative_cycle"]))
    if not got["found"]:
        return ShortestPath()
    return ShortestPath(list(got["arcs"]), float(got["length"]), True)


def same(a: ShortestPath, b: ShortestPath) -> None:
    assert a.found == b.found
    assert a.arcs == b.arcs
    assert a.negative_cycle == b.negative_cycle
    if a.found:
        assert a.length == pytest.approx(b.length, rel=1e-12)


CASES = {
    "two lanes": {"tau": [0, 0], "sig": [1, 1], "a": [0.999, 0.99]},
    "series": {"tau": [0, 0, 1], "sig": [2, 1, 2], "a": [0.99, 0.9995, 0.9995]},
    "diamond": {"tau": [0, 0, 1, 2], "sig": [1, 2, 3, 3],
                    "a": [0.999, 0.998, 0.9995, 0.9999]},
    "unreachable": {"tau": [0], "sig": [1], "a": [0.999], "n": 3},
    "battery": {"tau": [0, 0, 1], "sig": [2, 1, 2], "a": [0.99, 1.001, 1.001]},
}


@pytest.mark.parametrize("name", sorted(CASES))
def test_the_port_reproduces_the_reference(name):
    spec = dict(CASES[name])
    n = spec.pop("n", None)
    g = make(**spec, n=n)
    dst = g.n_nodes - 1
    adj = build_adjacency(g.tau, g.sig, g.n_nodes)
    same(spfa(g, 0, dst, adj), rust(g, 0, dst))


@pytest.mark.parametrize("max_hops", [1, 2, 3, 8])
def test_the_hop_cap_agrees(max_hops):
    g = make([0, 1, 2, 0], [1, 2, 3, 3], [0.9999, 0.9999, 0.9999, 0.99])
    adj = build_adjacency(g.tau, g.sig, g.n_nodes)
    same(spfa(g, 0, 3, adj, max_hops=max_hops),
         rust(g, 0, 3, max_hops=max_hops))


@pytest.mark.parametrize("banned", [(), (0,), (1,), (0, 1)])
def test_banned_arcs_agree(banned):
    """Yen's spur paths are built entirely out of this."""
    g = make([0, 0, 1], [1, 1, 2], [0.999, 0.998, 0.9995])
    adj = build_adjacency(g.tau, g.sig, g.n_nodes)
    same(spfa(g, 0, 2, adj, banned_arcs=set(banned)),
         rust(g, 0, 2, banned_arcs=list(banned)))


def test_banned_nodes_agree():
    g = make([0, 0, 1, 2], [1, 2, 3, 3], [0.999, 0.998, 0.9995, 0.9999])
    adj = build_adjacency(g.tau, g.sig, g.n_nodes)
    same(spfa(g, 0, 3, adj, banned_nodes={1}),
         rust(g, 0, 3, banned_nodes=[1]))


def test_custom_weights_agree():
    g = make([0, 0], [1, 1], [0.999, 0.99])
    adj = build_adjacency(g.tau, g.sig, g.n_nodes)
    w = np.array([5.0, 1.0])
    same(spfa(g, 0, 1, adj, weights=w), rust(g, 0, 1, weights=w))


@pytest.mark.parametrize("seed", range(24))
def test_random_graphs_agree(seed):
    rng = np.random.default_rng(seed)
    n = int(rng.integers(3, 14))
    m = int(rng.integers(n, 4 * n))
    tau = rng.integers(0, n, m)
    sig = rng.integers(0, n, m)
    keep = tau != sig
    tau, sig = tau[keep], sig[keep]
    if len(tau) < 2:
        pytest.skip("degenerate draw")
    # Rates straddling 1.0, so `eps` goes negative and Dijkstra would be wrong.
    a = 1.0 + (rng.random(len(tau)) - 0.5) * 2e-3
    g = make(tau, sig, a, n=n)
    adj = build_adjacency(g.tau, g.sig, g.n_nodes)
    dst = n - 1
    banned = set(rng.choice(len(tau), size=int(rng.integers(0, 3)), replace=False).tolist())
    same(spfa(g, 0, dst, adj, banned_arcs=banned),
         rust(g, 0, dst, banned_arcs=sorted(banned)))
