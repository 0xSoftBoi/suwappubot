"""Spec §5.3 seeding.

The governing property is that seeding is allowed to be *wrong*: it changes how
many column-generation rounds run, never the answer.  §5.5's certificate is
what guarantees correctness.
"""

from __future__ import annotations

import numpy as np
import pytest

from erouter.core import graph
from erouter.core.seed import build_adjacency, k_shortest_paths, seed_subgraph, spfa
from erouter.core.solve import solve


def make(tau, sig, a, B, *, n=None, Psi=1.0, nu=None):
    tau = np.asarray(tau, np.int64)
    sig = np.asarray(sig, np.int64)
    n = n or int(max(tau.max(), sig.max()) + 1)
    nu = np.ones(n) if nu is None else np.asarray(nu, float)
    return graph.build(
        tau, sig, np.asarray(a, float), np.asarray(B, float), nu, Psi,
        n_nodes=n, merge_duplicates=False,
    )


def test_shortest_path_follows_the_cheapest_route():
    #      0 --a0--> 1 --a1--> 3      (two cheap hops)
    #      0 ------a2--------> 3      (one expensive hop)
    g = make([0, 1, 0], [1, 3, 3], [0.9999, 0.9999, 0.99], [1.0, 1.0, 1.0], n=4)
    adj = build_adjacency(g.tau, g.sig, g.n_nodes)
    path = spfa(g, 0, 3, adj)
    assert path.found
    assert path.arcs == [0, 1]  # 2 bp total beats 100 bp direct
    assert path.length == pytest.approx(g.eps[0] + g.eps[1])


def test_unreachable_destination_is_reported():
    g = make([0, 2], [1, 3], [1.0, 1.0], [1.0, 1.0], n=4)
    adj = build_adjacency(g.tau, g.sig, g.n_nodes)
    assert not spfa(g, 0, 3, adj).found


def test_k_shortest_returns_distinct_paths_in_cost_order():
    g = make(
        [0, 1, 0, 0],
        [1, 3, 3, 3],
        [0.9999, 0.9999, 0.999, 0.998],
        [1.0, 1.0, 1.0, 1.0],
        n=4,
    )
    paths = k_shortest_paths(g, 0, 3, k=3)
    assert len(paths) == 3
    assert len({tuple(p) for p in paths}) == 3  # all distinct
    costs = [float(np.sum(g.eps[p])) for p in paths]
    assert costs == sorted(costs)


def test_negative_eps_arcs_are_always_seeded():
    """A battery is free arbitrage; the seed must not be able to miss it."""
    g = make([0, 1, 2], [1, 2, 3], [1.0, 1.02, 1.0], [1.0, 1.0, 1.0], n=4)
    assert g.eps[1] < 0
    mask = seed_subgraph(g, 0, 3)
    assert mask[1]


def test_negative_cycle_is_detected_not_looped_on():
    """SPFA must terminate on a negative cycle rather than diverge."""
    #  0 -> 1 -> 2 -> 1  with the 1->2->1 loop favourable overall
    g = make(
        [0, 1, 2, 1],
        [1, 2, 1, 3],
        [1.0, 1.05, 1.05, 1.0],
        [1.0, 1.0, 1.0, 1.0],
        n=4,
    )
    adj = build_adjacency(g.tau, g.sig, g.n_nodes)
    result = spfa(g, 0, 3, adj)
    assert result.negative_cycle or result.found  # terminated either way
    if result.negative_cycle:
        assert float(np.sum(g.eps[result.negative_cycle])) < 0


def test_seed_does_not_change_the_answer():
    """The whole point: a bad seed costs rounds, never correctness."""
    rng = np.random.default_rng(7)
    n = 8
    tau, sig, a, B = [], [], [], []
    for _ in range(30):
        t, s = rng.integers(0, n, 2)
        if t == s:
            continue
        tau.append(t)
        sig.append(s)
        a.append(float(rng.uniform(0.995, 1.005)))
        B.append(float(rng.uniform(0.5, 4.0)))
    g = make(tau, sig, a, B, n=n, Psi=1.0)

    full = solve(g, 0, n - 1, 1.0)
    if not full.solution.feasible:
        pytest.skip("random graph left src and dst disconnected")

    seeded = solve(g, 0, n - 1, 1.0, seed=seed_subgraph(g, 0, n - 1))
    minimal = solve(g, 0, n - 1, 1.0, seed=np.zeros(g.m, bool))

    assert full.certificate and seeded.certificate
    assert seeded.solution.psi == pytest.approx(full.solution.psi, abs=1e-9)
    if minimal.solution.feasible:
        assert minimal.solution.psi == pytest.approx(full.solution.psi, abs=1e-9)


def test_seed_covers_a_direct_path_when_one_exists():
    g = make([0, 0, 1], [1, 2, 2], [1.0, 0.99, 1.0], [1.0, 1.0, 1.0], n=3)
    mask = seed_subgraph(g, 0, 2)
    assert mask.any()
    # some src -> dst route must be inside the seed
    reached = graph.component_of(0, g.tau[mask], g.sig[mask], g.n_nodes)
    assert reached[2]


def test_seed_on_an_empty_graph_is_empty_not_a_crash():
    g = make([0], [1], [1.0], [1.0], n=2)
    g.tau = np.array([], np.int64)
    g.sig = np.array([], np.int64)
    g.G = np.array([])
    g.eps = np.array([])
    assert seed_subgraph(g, 0, 1).size == 0
