"""Sybil-resistant, verification-weighted reputation over Arbiter attestations (reference implementation).

Idea (after Anduin, arXiv 2611.05586, and the classic max-flow trust line: Advogato / SybilLimit):
  - Nodes = NEAR accounts. An ATTESTED escrow (status Paid, verdict pass) is an undirected edge buyer--worker
    with capacity  strength(rubric) * min(amount, EDGE_CAP).
  - A provider's rating, from the viewpoint of a trusted seed set T, is the MAX FLOW from T to the provider.
  - Sybil bound: flow into any region is at most the capacity of the edges crossing into it ("attack edges").
    A wash-trading island attached to the honest graph only through value that honest parties really paid or
    earned can never receive more flow than that value. Island-internal wash volume contributes nothing.

Policy parameters (STRENGTH, EDGE_CAP, the seed set) are choices, not derived facts. Pure stdlib; integer math.
"""
from collections import deque

SCALE = 1_000_000  # micro-NEAR integers
EDGE_CAP = 10.0  # NEAR: one escrow can't dominate a rating
# Verification strength per rubric. Deterministic, enclave-fetched rubrics = 1.0. A rubric that only
# witnesses (proxy-evaluated) or an LLM-judged one would get < 1.0; none of those exist in Arbiter today.
STRENGTH = {"github_pr_v1": 1.0, "http_json_v1": 1.0}


class Dinic:
    def __init__(self, n):
        self.g = [[] for _ in range(n)]

    def add(self, u, v, c, rc=0):
        self.g[u].append([v, c, len(self.g[v])])
        self.g[v].append([u, rc, len(self.g[u]) - 1])

    def maxflow(self, s, t):
        flow = 0
        while True:
            level = [-1] * len(self.g)
            level[s] = 0
            q = deque([s])
            while q:
                u = q.popleft()
                for v, c, _ in self.g[u]:
                    if c > 0 and level[v] < 0:
                        level[v] = level[u] + 1
                        q.append(v)
            if level[t] < 0:
                return flow
            it = [0] * len(self.g)

            def dfs(u, f):
                if u == t:
                    return f
                while it[u] < len(self.g[u]):
                    e = self.g[u][it[u]]
                    v, c, r = e
                    if c > 0 and level[v] == level[u] + 1:
                        d = dfs(v, min(f, c))
                        if d > 0:
                            e[1] -= d
                            self.g[v][r][1] += d
                            return d
                    it[u] += 1
                return 0

            while True:
                f = dfs(s, 1 << 60)
                if f == 0:
                    break
                flow += f


def edge_capacity(amount_near, rubric):
    return int(round(min(amount_near, EDGE_CAP) * STRENGTH.get(rubric, 0.0) * SCALE))


def build(edges, seeds):
    """edges: [{buyer, worker, amount (NEAR float), rubric}] (attested only). Returns (index, capacity list)."""
    idx, cap = {}, {}
    for e in edges:
        c = edge_capacity(e["amount"], e["rubric"])
        if c <= 0 or e["buyer"] == e["worker"]:  # self-payments carry no information
            continue
        k = tuple(sorted((e["buyer"], e["worker"])))
        cap[k] = cap.get(k, 0) + c
        for a in k:
            idx.setdefault(a, len(idx))
    for s in seeds:
        idx.setdefault(s, len(idx))
    return idx, cap


def rating(idx, cap, seeds, target):
    """Max-flow (micro-NEAR) from the seed set to `target`."""
    if target not in idx or target in seeds:
        return 0
    n = len(idx)
    d = Dinic(n + 1)
    src = n
    for (a, b), c in cap.items():
        d.add(idx[a], idx[b], c, c)
    for s in seeds:
        d.add(src, idx[s], 1 << 50)
    return d.maxflow(src, idx[target])


def ratings(edges, seeds, targets):
    idx, cap = build(edges, seeds)
    return {t: rating(idx, cap, set(seeds), t) / SCALE for t in targets}
