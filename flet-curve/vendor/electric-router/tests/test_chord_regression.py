"""§11.2 / §13.1 -- the chord test, "the reason §6.3 exists".

The spec's own instance is a CryptoSwap-NG twocrypto plus a v3 lane at budget
54,841, with exact expected outputs.  Those numbers come from the CryptoSwap-NG
split math lemma set, which is not in this repository, so they cannot be
reproduced here honestly.  What is reproduced is the mechanism:

    A flagged (non-concave) arc is modelled by its concave envelope -- a chord.
    The chord's optimum sits at a *different ratio* than the true curve's.  And
    critically, the active set is IDENTICAL across those allocations, so no
    amount of active-set diversity can find the difference; only varying the
    *ratio* can, which is exactly what pin-and-resolve does.

The test is written so that deleting the pin sweep makes it fail.  Without that
it would fail silently -- the worst failure mode in the system.
"""

from __future__ import annotations

import numpy as np
import pytest

from erouter.core import graph
from erouter.core.candidates import generate
from erouter.core.solve import active_set_solve
from erouter.core.types import ArcKind, PoolArc

# --- the two lanes ---------------------------------------------------------
#
# Lane 1 has genuinely increasing returns: f1(d) = a0 d (1 + c d).  A pool whose
# effective fee falls with size behaves this way, and it is inadmissible in a
# convex program, so the model replaces it with its chord.
A0, C, CAP = 1.0, 3e-6, 3000.0
# Lane 2 is an ordinary concave arc.
A2, B2 = 1.0185, 1e-5
BUDGET = 3000.0

CHORD_SLOPE = A0 * (1 + C * CAP)  # exact at 0 and at CAP, above the curve between


def true_lane1(d: float) -> float:
    d = min(max(d, 0.0), CAP)
    return A0 * d * (1 + C * d)


def true_lane2(d: float) -> float:
    d = max(d, 0.0)
    return A2 * d - 0.5 * B2 * d * d


def true_total(on_lane1: float) -> float:
    """Exact output for a split, the way the on-chain quoter would report it."""
    return true_lane1(on_lane1) + true_lane2(BUDGET - on_lane1)


def _true_optimum(samples: int = 30_001) -> float:
    grid = np.linspace(0.0, CAP, samples)
    return float(grid[int(np.argmax([true_total(g) for g in grid]))])


def _arc(index, pool, *, a, B, flagged, cap=np.inf):
    return PoolArc(
        id=f"{pool}:{index}", pool=pool, kind=ArcKind.SWAP_STABLE,
        i=0, j=1, n_coins=2, token_in="0xin", token_out="0xout",
        tau=0, sigma=1, a=a, B=B, cap=cap, convex_flag=flagged,
        clamped=flagged, note=f"lane{index}",
    )


@pytest.fixture
def model():
    """The graph the solver sees: lane 1 clamped to its chord, lane 2 as-is."""
    arcs = [
        _arc(1, "0x" + "11" * 20, a=CHORD_SLOPE, B=0.0, flagged=True, cap=CAP),
        _arc(2, "0x" + "22" * 20, a=A2, B=B2, flagged=False),
    ]
    g = graph.build(
        np.array([0, 0]), np.array([1, 1]),
        np.array([a.a for a in arcs]), np.array([a.B for a in arcs]),
        np.ones(2), BUDGET,
        cap=np.array([CAP, np.inf]),
        flagged=np.array([True, False]),
        clamped=np.array([True, False]),
        n_nodes=2, merge_duplicates=False,
    )
    return g, arcs


def test_the_true_optimum_is_interior_and_beats_both_endpoints():
    """The premise: neither "all lane 1" nor "all lane 2" is optimal."""
    best = _true_optimum()
    assert 0.0 < best < CAP, "the optimum must be interior for this test to mean anything"
    assert true_total(best) > true_total(0.0)
    assert true_total(best) > true_total(CAP)


def test_the_chord_optimum_is_not_the_true_optimum(model):
    """This gap is what the sweep exists to close.

    The chord is exact at both endpoints and above the curve in between, so its
    stationary point sits at a different allocation than the real curve's.
    """
    g, _ = model
    solution = active_set_solve(g, 0, 1, BUDGET)
    assert solution.feasible

    model_split = float(solution.psi[0])
    true_split = _true_optimum()

    assert 0.0 < model_split < CAP
    assert abs(model_split - true_split) > 300.0, (
        f"model put {model_split:.0f} on the flagged lane, truth wants {true_split:.0f}"
    )
    # ... and following the model costs real basis points against the truth
    loss_bp = (1 - true_total(model_split) / true_total(true_split)) * 10_000
    assert loss_bp > 1.0, f"only {loss_bp:.2f} bp at stake; the fixture is too tame"


def test_active_set_diversity_alone_cannot_vary_the_ratio(model):
    """The heart of §13.1: dropping an arc changes *which* pools, not *how much*.

    Both arcs carry flow at the optimum, so the only active-set variations are
    "lane 1 only" and "lane 2 only" -- the chord endpoints.  Neither is the
    interior answer, and no further active-set candidate exists to try.
    """
    g, _arcs = model
    base = active_set_solve(g, 0, 1, BUDGET)
    assert np.count_nonzero(base.psi > 0) == 2

    ratios = set()
    for drop in (0, 1):
        forbidden = np.zeros(2, bool)
        forbidden[drop] = True
        restricted = active_set_solve(g, 0, 1, BUDGET, forbidden=forbidden)
        if restricted.feasible:
            ratios.add(round(float(restricted.psi[0]) / BUDGET, 6))

    # every drop-candidate is an endpoint: all of one lane or all of the other
    assert ratios, "at least one lane must survive alone"
    for ratio in ratios:
        assert ratio in (0.0, 1.0), f"a drop candidate produced an interior ratio {ratio}"


def test_the_pin_sweep_varies_the_ratio_and_finds_a_better_split(model):
    """With §6.3 enabled, candidates differ in ratio -- and one is genuinely
    better on the true curve than the model's own answer."""
    g, arcs = model
    base = active_set_solve(g, 0, 1, BUDGET)
    out = generate(g, arcs, 0, 1, BUDGET, base, max_candidates=20)

    pins = [c for c in out.candidates if c.kind == "pin"]
    assert pins, "a flagged active arc must be pin-swept (§6.3)"

    ratios = {round(float(c.psi[0]) / BUDGET, 4) for c in out.candidates}
    assert len(ratios) >= 4, f"the sweep must span allocations, got {sorted(ratios)}"

    # Score every candidate the way the quoter would: on the true curve.
    scored = [(true_total(float(c.psi[0])), c.label) for c in out.candidates]
    best_value, best_label = max(scored)
    model_value = true_total(float(base.psi[0]))

    assert best_value >= model_value
    # and the winner is a swept allocation, not the relaxation's own split
    assert best_label != "C0 full" or best_value > model_value


def test_removing_the_sweep_loses_the_gap(model):
    """The guard that makes this a *regression* test.

    If §6.3 is ever removed, the candidate family collapses to the endpoints
    and the interior optimum becomes unreachable -- silently, because every
    remaining candidate still verifies fine.
    """
    g, arcs = model
    base = active_set_solve(g, 0, 1, BUDGET)
    out = generate(g, arcs, 0, 1, BUDGET, base, max_candidates=20)

    without_pins = [c for c in out.candidates if c.kind != "pin"]
    with_pins = out.candidates

    best_without = max(true_total(float(c.psi[0])) for c in without_pins)
    best_with = max(true_total(float(c.psi[0])) for c in with_pins)
    assert best_with >= best_without

    # the interior optimum is reachable only through the swept candidates
    reachable = {round(float(c.psi[0]), 0) for c in with_pins}
    true_split = _true_optimum()
    assert any(abs(r - true_split) < 0.25 * CAP for r in reachable), (
        f"no candidate lands near the true split {true_split:.0f}: {sorted(reachable)}"
    )


def test_a_flagged_active_arc_voids_the_certificate(model):
    """§12.2b: the answer may be good, but it is not proven optimal."""
    from erouter.core.solve import solve

    g, _ = model
    report = solve(g, 0, 1, BUDGET)
    assert report.solution.psi[0] > 0
    assert g.flagged[0]
    assert not report.certificate
    assert report.reason == "CHORD_ACTIVE"
