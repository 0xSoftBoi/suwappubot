"""Seed subgraph for column generation (spec §5.3).

The union of:

* the `k` shortest `src -> dst` paths under edge length `eps_p`,
* the top-conductance arcs incident to any node those paths touch (breadth,
  not depth -- the solver finds depth by itself),
* any negative-`eps` cycle reachable from the path set, which is free
  arbitrage the router should absorb.

`eps_p` can be negative -- a favourably dislocated pool is an EMF -- so this
uses SPFA (queue-based Bellman-Ford) rather than Dijkstra, and detects negative
cycles instead of looping on them.

**Seed quality only affects how many column-generation rounds run, never the
answer** (§5.5's certificate is what guarantees correctness), so this file is
allowed to be approximate and is not allowed to be slow.
"""

from __future__ import annotations

import heapq
import os
from collections import deque
from dataclasses import dataclass, field

import numpy as np

from . import accel as _accel
from .graph import ArcArrays

INF = float("inf")

# Relaxation depth for the seed searches.  Real Curve routes are 1-3 hops
# (mainnet universe: mean 1.97, max 3), so this is generous -- but it turns each
# search from "iterate to a fixed point over 301 nodes" into a bounded sweep.
# Safe in a way bounding the solve would not be: §5.5's certificate prices out
# *all* m arcs, so a path the seed misses is still found by column generation.
MAX_HOPS = 8
#: Opt-in on the same switch as the rest of the port.
_ACCEL_ON = os.environ.get("EROUTER_ACCEL", "") == "1"


@dataclass(slots=True)
class Adjacency:
    """Outgoing arc indices per node, in CSR form.

    Carries plain-`list` mirrors beside the numpy arrays: the relaxation loop
    below reads single elements ~300k times per route, and a boxed numpy scalar
    costs 72.8 ns against 21.2 ns for a list element.  Building the mirrors is
    one vectorised pass; the loop that consumes them is the hottest in the
    router.
    """

    starts: np.ndarray
    arcs: np.ndarray
    starts_list: list[int] = field(default_factory=list)
    arcs_list: list[int] = field(default_factory=list)

    def out(self, node: int) -> np.ndarray:
        return self.arcs[self.starts[node] : self.starts[node + 1]]


def build_adjacency(tau: np.ndarray, sig: np.ndarray, n: int) -> Adjacency:
    del sig
    order = np.argsort(tau, kind="stable")
    counts = np.bincount(tau, minlength=n)
    starts = np.zeros(n + 1, dtype=np.int64)
    np.cumsum(counts, out=starts[1:])
    arcs = order.astype(np.int64)
    return Adjacency(starts, arcs, starts.tolist(), arcs.tolist())


@dataclass(slots=True)
class ShortestPath:
    arcs: list[int] = field(default_factory=list)
    length: float = INF
    found: bool = False
    negative_cycle: list[int] = field(default_factory=list)


def spfa(
    g: ArcArrays,
    src: int,
    dst: int,
    adj: Adjacency,
    *,
    banned_arcs: set[int] | None = None,
    banned_nodes: set[int] | None = None,
    weights: np.ndarray | None = None,
    max_hops: int = MAX_HOPS,
) -> ShortestPath:
    """Shortest `src -> dst` path by arc length `eps`, tolerating negative arcs.

    Bellman-Ford with a FIFO queue (SPFA), not Dijkstra: `eps_p` can be
    **negative** -- a favourably dislocated pool is an EMF -- and Dijkstra needs
    non-negative weights.  Returns the arc indices of the path; a reachable
    negative cycle comes back separately rather than the search diverging.

    `max_hops` caps the path depth, which makes the search approximate (a node
    reached cheaply but deep may keep a shallower, dearer label).  §5.3 permits
    that: the seed decides how many CG rounds run, not what the answer is.

    Everything in the loop is a plain Python `int`/`float` read out of a list;
    the numpy arrays cost 3.4x as much per access.
    """
    # The compiled search when installed: same algorithm, same tie-breaks, and
    # `tests/test_seed_differential.py` differs the two.
    if _ACCEL_ON and _accel.available():
        got = _accel.shortest_path(
            g, src, dst, banned_arcs=banned_arcs, banned_nodes=banned_nodes,
            weights=weights, max_hops=max_hops)
        if got is not None:
            if got["negative_cycle"]:
                return ShortestPath(negative_cycle=list(got["negative_cycle"]))
            if not got["found"]:
                return ShortestPath()
            return ShortestPath(list(got["arcs"]), float(got["length"]), True)

    n = g.n_nodes
    banned_arcs = banned_arcs or set()
    banned_nodes = banned_nodes or set()
    cost = (g.eps if weights is None else weights).tolist()
    head_of = g.sig.tolist()
    starts, arc_order = adj.starts_list, adj.arcs_list

    dist = [INF] * n
    parent = [-1] * n  # arc index used to reach the node
    hops = [0] * n
    in_queue = [False] * n
    # Depth-bounding already forces termination -- every relaxation strictly
    # lowers a `dist` and only walks of at most `max_hops` arcs exist -- so this
    # is a backstop against a pathology in the bound, not the mechanism.
    budget = 8 * max_hops * n

    dist[src] = 0.0
    # FIFO through a deque: `list.pop(0)` memmoves the queue, ~127k times a route.
    queue: deque[int] = deque((src,))
    in_queue[src] = True

    while queue and budget > 0:
        node = queue.popleft()
        in_queue[node] = False
        depth = hops[node] + 1
        if depth > max_hops:
            continue
        base = dist[node]
        for k in range(starts[node], starts[node + 1]):
            arc = arc_order[k]
            if arc in banned_arcs:
                continue
            head = head_of[arc]
            if head in banned_nodes:
                continue
            candidate = base + cost[arc]
            if candidate < dist[head] - 1e-15:
                dist[head] = candidate
                parent[head] = arc
                hops[head] = depth
                budget -= 1
                if not in_queue[head]:
                    queue.append(head)
                    in_queue[head] = True

    if dist[dst] == INF:
        return ShortestPath()

    # Walk the parent pointers back.  A negative cycle shows up here and only
    # here: `dist` keeps falling around the loop, so the chain from `dst`
    # re-enters a node it already passed instead of reaching `src`.  Detecting
    # it on the walk needs no relaxation counters in the inner loop.
    tail_of = g.tau.tolist()
    arcs: list[int] = []
    seen_at: dict[int, int] = {}
    node = dst
    while node != src:
        if node in seen_at:
            cycle = arcs[seen_at[node] :]
            cycle.reverse()
            return ShortestPath(negative_cycle=cycle)
        seen_at[node] = len(arcs)
        arc = parent[node]
        if arc < 0:
            return ShortestPath()
        arcs.append(arc)
        node = tail_of[arc]
    arcs.reverse()
    return ShortestPath(arcs, float(dist[dst]), True)


def k_shortest_paths(
    g: ArcArrays, src: int, dst: int, k: int = 10, adj: Adjacency | None = None
) -> list[list[int]]:
    """Yen's algorithm over `eps`, returning arc-index paths.

    Only ever returns genuine `src -> dst` paths.  A negative cycle is not one:
    conflating the two lets a caller warm-start the solver from a loop that
    does not contain `src`, which then reports the graph as disconnected.
    """
    adj = adj or build_adjacency(g.tau, g.sig, g.n_nodes)

    weights = None
    first = spfa(g, src, dst, adj)
    if first.negative_cycle:
        # §5.3: "shift by min(0, min_p eps_p) and correct".  Shifting changes a
        # path's cost per hop rather than preserving the order, so the result is
        # only approximately cheapest -- fine, since seed quality affects rounds.
        weights = g.eps - min(0.0, float(g.eps.min()))
        first = spfa(g, src, dst, adj, weights=weights)
    if not first.found:
        return []

    accepted: list[list[int]] = [first.arcs]
    candidates: list[tuple[float, list[int]]] = []
    seen = {tuple(first.arcs)}

    while len(accepted) < k:
        previous = accepted[-1]
        for i in range(len(previous)):
            root = previous[:i]
            spur_node = int(g.tau[previous[i]])

            banned_arcs = {
                path[i]
                for path in accepted
                if len(path) > i and path[:i] == root
            }
            banned_nodes = {int(g.tau[arc]) for arc in root}

            spur = spfa(
                g, spur_node, dst, adj, weights=weights,
                banned_arcs=banned_arcs, banned_nodes=banned_nodes,
            )
            if not spur.found:
                continue
            whole = root + spur.arcs
            key = tuple(whole)
            if key in seen:
                continue
            seen.add(key)
            heapq.heappush(candidates, (float(np.sum(g.eps[whole])), whole))

        if not candidates:
            break
        accepted.append(heapq.heappop(candidates)[1])

    return accepted


def seed_subgraph(
    g: ArcArrays,
    src: int,
    dst: int,
    *,
    k: int = 10,
    breadth: int = 8,
    include_negative: bool = True,
) -> np.ndarray:
    """Boolean mask of arcs to start column generation from.

    `breadth` is how many top-conductance arcs to add per touched node.  Breadth
    rather than depth: the solver discovers depth through pricing-out, but it can
    only price in an arc that some node makes reachable.
    """
    mask = np.zeros(g.m, bool)
    if g.m == 0:
        return mask

    adj = build_adjacency(g.tau, g.sig, g.n_nodes)
    paths = k_shortest_paths(g, src, dst, k, adj)
    for path in paths:
        mask[path] = True

    touched = {src, dst}
    for path in paths:
        for arc in path:
            touched.add(int(g.tau[arc]))
            touched.add(int(g.sig[arc]))

    # Top-G arcs incident to any touched node, in either direction.
    incident_to = np.isin(g.tau, list(touched)) | np.isin(g.sig, list(touched))
    for node in touched:
        local = np.flatnonzero(incident_to & ((g.tau == node) | (g.sig == node)))
        if local.size > breadth:
            local = local[np.argsort(-g.G[local])[:breadth]]
        mask[local] = True

    if include_negative:
        # Free arbitrage the router should absorb; also cheap insurance against
        # a seed that missed a battery path entirely.
        mask[g.eps < 0] = True

    return mask
