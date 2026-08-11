#!/usr/bin/env python3
"""A tiny content-addressed DAG runner for the Positions pipeline.

Why a graph and not a script: the 10,000-card sweep is expensive, it is run
repeatedly while the renderer changes, and a `/loop` tick must be able to pick
up exactly where the last one stopped. Nodes are cached by the hash of
(version, params, dependency hashes), so editing one node re-runs that node and
everything downstream of it — and nothing else.

    from graph import Graph
    g = Graph(cache_dir=".cache")
    g.node("registry", deps=[], fn=lambda _: load_registry())
    g.node("corpus", deps=["registry"], fn=build_corpus, params={"n": 10000})
    g.run("corpus")

Determinism is the point. Every node must be a pure function of its declared
inputs; anything that reads the clock, the network or the chain belongs at the
edges (the serving layer), not in here.
"""

import hashlib
import json
import os
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Callable, Optional


class NodeError(RuntimeError):
    pass


class _Node:
    __slots__ = ("name", "deps", "fn", "params", "version", "cache", "digest", "value")

    def __init__(self, name, deps, fn, params, version, cache):
        self.name = name
        self.deps = list(deps)
        self.fn = fn
        self.params = params or {}
        self.version = version
        self.cache = cache
        self.digest: Optional[str] = None
        self.value = None


class Graph:
    """Nodes are pure functions of their declared inputs. Results are cached on
    disk by content hash and reused across runs and across `/loop` ticks."""

    def __init__(self, cache_dir: Optional[str] = None, workers: int = 4):
        self._nodes: dict[str, _Node] = {}
        self._cache_dir = cache_dir
        self._workers = max(1, workers)
        self.stats = {"ran": 0, "cached": 0, "seconds": 0.0}
        if cache_dir:
            os.makedirs(cache_dir, exist_ok=True)

    def node(
        self,
        name: str,
        deps: list,
        fn: Callable,
        params: Optional[dict] = None,
        version: str = "1",
        cache: bool = True,
    ) -> "Graph":
        """Register a node. `fn` receives {dep_name: value} and returns a
        JSON-serialisable value (or anything, if cache=False)."""
        if name in self._nodes:
            raise NodeError(f"duplicate node: {name}")
        self._nodes[name] = _Node(name, deps, fn, params, version, cache)
        return self

    # ── planning ─────────────────────────────────────────────────────────────

    def _order(self, target: str) -> list:
        """Topological order for `target`, raising on a missing dep or a cycle
        rather than deadlocking or silently dropping work."""
        order, temp, done = [], set(), set()

        def visit(name, path):
            if name in done:
                return
            if name in temp:
                raise NodeError("cycle: " + " -> ".join(path + [name]))
            if name not in self._nodes:
                raise NodeError(f"unknown node: {name} (needed by {path[-1] if path else 'run'})")
            temp.add(name)
            for d in self._nodes[name].deps:
                visit(d, path + [name])
            temp.discard(name)
            done.add(name)
            order.append(name)

        visit(target, [])
        return order

    def _digest(self, node: _Node) -> str:
        h = hashlib.sha256()
        h.update(node.name.encode())
        h.update(node.version.encode())
        h.update(json.dumps(node.params, sort_keys=True, default=str).encode())
        for d in node.deps:
            dep = self._nodes[d]
            if dep.digest is None:
                raise NodeError(f"{node.name}: dependency {d} not resolved")
            h.update(dep.digest.encode())
        return h.hexdigest()[:16]

    def _cache_path(self, node: _Node) -> Optional[str]:
        if not (self._cache_dir and node.cache):
            return None
        return os.path.join(self._cache_dir, f"{node.name}-{node.digest}.json")

    # ── execution ────────────────────────────────────────────────────────────

    def run(self, target: str, force: Optional[set] = None) -> dict:
        """Execute everything `target` needs and return {name: value}.

        Independent nodes at the same depth run concurrently; a node whose
        cached digest still matches is not run at all.
        """
        force = force or set()
        order = self._order(target)
        started = time.monotonic()

        # Group by depth so independent work at the same level overlaps. Depth
        # is 1 + max(dep depth), which is exactly "cannot start before".
        depth: dict[str, int] = {}
        for name in order:
            n = self._nodes[name]
            depth[name] = 1 + max((depth[d] for d in n.deps), default=-1)
        levels: dict[int, list] = {}
        for name in order:
            levels.setdefault(depth[name], []).append(name)

        for level in sorted(levels):
            batch = levels[level]
            for name in batch:  # digests are cheap and must be set before fan-out
                node = self._nodes[name]
                node.digest = self._digest(node)

            def execute(name):
                node = self._nodes[name]
                path = self._cache_path(node)
                if path and name not in force and os.path.exists(path):
                    try:
                        with open(path) as f:
                            node.value = json.load(f)["value"]
                        self.stats["cached"] += 1
                        return
                    except Exception:
                        pass  # a corrupt cache entry is a re-run, not a failure
                inputs = {d: self._nodes[d].value for d in node.deps}
                node.value = node.fn(inputs, **node.params) if node.params else node.fn(inputs)
                self.stats["ran"] += 1
                if path:
                    tmp = path + ".tmp"
                    with open(tmp, "w") as f:
                        json.dump({"node": name, "value": node.value}, f)
                    os.replace(tmp, path)  # atomic: a killed run never leaves a half file

            if len(batch) == 1:
                execute(batch[0])
            else:
                with ThreadPoolExecutor(max_workers=min(self._workers, len(batch))) as ex:
                    for _ in ex.map(execute, batch):
                        pass

        self.stats["seconds"] = round(time.monotonic() - started, 3)
        return {name: self._nodes[name].value for name in order}

    def describe(self, target: str) -> list:
        """(name, deps, depth) in execution order — for `--plan`."""
        order = self._order(target)
        depth: dict[str, int] = {}
        out = []
        for name in order:
            n = self._nodes[name]
            depth[name] = 1 + max((depth[d] for d in n.deps), default=-1)
            out.append((name, list(n.deps), depth[name]))
        return out
