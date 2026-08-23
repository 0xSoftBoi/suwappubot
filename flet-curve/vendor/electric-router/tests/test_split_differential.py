"""The compiled split search against the reference.

The ascent decides how a trade divides across lanes, so agreement has to be on
the weights it lands on, not merely on finding a good value: two splits worth
the same to the model are two different routes to execute, and the loser is
what the chain quotes afterwards.
"""

from __future__ import annotations

import numpy as np
import pytest

from erouter.core import accel, split
from erouter.core.curves import Curve

pytestmark = pytest.mark.skipif(
    not accel.available(), reason="the Rust search is not installed")


def curve(x, y):
    """A sampled curve through `(x, f(x))`, as `sample_curves` would build it."""
    x = [float(v) for v in x]
    u = [xi / yi for xi, yi in zip(x, y, strict=True)]
    slope = [(u[k + 1] - u[k]) / (x[k + 1] - x[k]) for k in range(len(x) - 1)]
    tail = slope[-1] if slope else 0.0
    return Curve(tuple(x), tuple(u), tuple(slope), y[0] / x[0], tail)


def cpmm(depth, sizes):
    """A constant-product lane of the given depth."""
    return curve(sizes, [depth * s / (depth + s) for s in sizes])


SIZES = [1.0, 10.0, 100.0, 1_000.0, 10_000.0]


def plan_for(curves, amount_in):
    """Two or more parallel lanes out of slot 0 into slot 1."""
    n = len(curves)
    legs = list(range(n))
    src_of = [0] * n
    dst_of = [1] * n
    heads = [legs[:-1]]
    tails = [legs[-1]]
    ev = split.make_evaluator.__wrapped__ if hasattr(split.make_evaluator, "__wrapped__") \
        else split.make_evaluator
    del ev
    return {"curves": [(list(c.x), list(c.u), list(c.slope), c.rate0, c.tail)
                        for c in curves],
                "src_of": src_of, "dst_of": dst_of, "static_share": [None] * n,
                "heads": heads, "tails": tails, "slots": 2, "dst_slot": 1,
                "amount_in": float(amount_in)}


def reference(plan, start, free, **kw):
    """The Python ascent over the same plan, via a hand-built evaluator."""
    curves = [Curve(tuple(x), tuple(u), tuple(s), r, t)
              for x, u, s, r, t in plan["curves"]]

    def evaluate(weights):
        fractions: list[float | None] = list(plan["static_share"])
        for head, tail, w in zip(plan["heads"], plan["tails"], weights, strict=True):
            clipped = [v if v > split.MIN_WEIGHT else split.MIN_WEIGHT for v in w]
            total = sum(clipped)
            if total > 0.0:
                for index, one in zip(head, clipped, strict=False):
                    fractions[index] = one / total
            else:
                for index in head:
                    fractions[index] = 1.0 / len(clipped)
            fractions[tail] = None
        balances = [0.0] * plan["slots"]
        balances[0] = plan["amount_in"]
        current, base = -1, 0.0
        for k in range(len(plan["src_of"])):
            source = plan["src_of"][k]
            if source != current:
                current, base = source, balances[source]
            available = balances[source]
            share = fractions[k]
            take = available if share is None else min(base * share, available)
            if take <= 0.0:
                continue
            balances[source] = available - take
            balances[plan["dst_of"][k]] += curves[k].at(take)
        return balances[plan["dst_slot"]]

    counter = [0]
    return split._ascend(start, evaluate, free, counter, **kw)


CASES = {
    "two equal lanes": ([1e6, 1e6], 100_000.0),
    "one deeper lane": ([1e7, 1e6], 100_000.0),
    "three lanes": ([1e7, 3e6, 1e6], 250_000.0),
    "a tiny trade": ([1e6, 1e6], 1.0),
    "past the last probe": ([1e6, 1e6], 1e6),
    "very lopsided": ([1e9, 1e5], 50_000.0),
}


@pytest.mark.parametrize("name", sorted(CASES))
def test_the_port_finds_the_same_split(name):
    depths, amount = CASES[name]
    curves = [cpmm(d, SIZES) for d in depths]
    plan = plan_for(curves, amount)
    n = len(curves)
    start = [np.full(n, 1.0 / n)]
    free = [(0, j) for j in range(n - 1)]

    want_rows, want_value = reference(plan, start, free)
    got = accel.split_ascend(plan, [list(w) for w in start], free,
                             min_weight=split.MIN_WEIGHT,
                             iters=split.GOLDEN_ITERS, sweeps=split.MAX_SWEEPS,
                             window=0.0, sweep_tol=split.SWEEP_TOL)
    assert got is not None
    got_rows, got_value, _ = got
    assert got_value == pytest.approx(want_value, rel=1e-12), "different value"
    for want_row, got_row in zip(want_rows, got_rows, strict=True):
        assert np.allclose(got_row, want_row, rtol=1e-9, atol=1e-12), "different split"


@pytest.mark.parametrize("window", [0.0, 0.05, 0.25])
def test_the_trust_window_agrees(window):
    """`polish` searches a window round the incumbent rather than the whole range."""
    curves = [cpmm(d, SIZES) for d in (1e7, 2e6, 1e6)]
    plan = plan_for(curves, 200_000.0)
    start = [np.array([0.5, 0.3, 0.2])]
    free = [(0, 0), (0, 1)]
    want_rows, want_value = reference(plan, start, free, window=window)
    got_rows, got_value, _ = accel.split_ascend(
        plan, [list(w) for w in start], free, min_weight=split.MIN_WEIGHT,
        iters=split.GOLDEN_ITERS, sweeps=split.MAX_SWEEPS, window=window,
        sweep_tol=split.SWEEP_TOL)
    assert got_value == pytest.approx(want_value, rel=1e-12)
    for want_row, got_row in zip(want_rows, got_rows, strict=True):
        assert np.allclose(got_row, want_row, rtol=1e-9, atol=1e-12)


@pytest.mark.parametrize("seed", range(24))
def test_random_lanes_agree(seed):
    rng = np.random.default_rng(seed)
    n = int(rng.integers(2, 5))
    depths = 10 ** rng.uniform(5, 8, size=n)
    curves = [cpmm(float(d), SIZES) for d in depths]
    amount = float(10 ** rng.uniform(1, 6))
    plan = plan_for(curves, amount)
    start = [np.asarray(rng.dirichlet(np.ones(n)), float)]
    free = [(0, j) for j in range(n - 1)]
    want_rows, want_value = reference(plan, start, free)
    got_rows, got_value, _ = accel.split_ascend(
        plan, [list(w) for w in start], free, min_weight=split.MIN_WEIGHT,
        iters=split.GOLDEN_ITERS, sweeps=split.MAX_SWEEPS, window=0.0,
        sweep_tol=split.SWEEP_TOL)
    assert got_value == pytest.approx(want_value, rel=1e-12)
    for want_row, got_row in zip(want_rows, got_rows, strict=True):
        assert np.allclose(got_row, want_row, rtol=1e-9, atol=1e-12)
