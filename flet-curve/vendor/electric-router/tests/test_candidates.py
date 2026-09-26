"""Candidate generation, conflict repair and verification ranking (§6, §7)."""

from __future__ import annotations

import numpy as np

from erouter.core import graph
from erouter.core.candidates import (
    CandidateSet,
    conflicting_pools,
    generate,
    keep_only,
    repair_order,
)
from erouter.core.solve import active_set_solve
from erouter.core.types import ArcKind, PoolArc
from erouter.core.verify import verify

POOL = ["0x" + f"{k:02x}" * 20 for k in range(1, 9)]


def arc(index, pool, tau, sigma, *, a=1.0, B=1.0, flagged=False):
    return PoolArc(
        id=f"{pool}:{index}", pool=pool, kind=ArcKind.SWAP_STABLE,
        i=0, j=1, n_coins=2, token_in=f"0xin{index}", token_out=f"0xout{index}",
        tau=tau, sigma=sigma, a=a, B=B, convex_flag=flagged, note=f"pool{index}",
    )


def build(arcs, *, Psi=1.0, n=None, flagged=None):
    tau = np.array([x.tau for x in arcs], np.int64)
    sig = np.array([x.sigma for x in arcs], np.int64)
    n = n or int(max(tau.max(), sig.max()) + 1)
    return graph.build(
        tau, sig,
        np.array([x.a for x in arcs]), np.array([x.B for x in arcs]),
        np.ones(n), Psi, n_nodes=n, merge_duplicates=False,
        flagged=np.array([x.convex_flag for x in arcs]) if flagged is None else flagged,
    )


# ----------------------------------------------------------------- generation


def test_generate_produces_a_deduplicated_family():
    arcs = [
        arc(0, POOL[0], 0, 1, B=1.0),
        arc(1, POOL[1], 0, 1, B=2.0),
        arc(2, POOL[2], 0, 1, B=4.0),
    ]
    g = build(arcs)
    base = active_set_solve(g, 0, 1, 1.0)
    out = generate(g, arcs, 0, 1, 1.0, base)

    assert len(out) >= 3
    assert out.candidates[0].label.startswith("C0")
    signatures = {tuple(np.round(c.psi / c.psi.sum(), 6)) for c in out.candidates}
    assert len(signatures) == len(out.candidates)  # no duplicates survive


def test_single_path_candidate_is_generated():
    """§6.2's `C_*`: the no-splitting fallback must always be on the menu."""
    arcs = [arc(0, POOL[0], 0, 1, B=1.0), arc(1, POOL[1], 0, 1, B=2.0)]
    g = build(arcs)
    base = active_set_solve(g, 0, 1, 1.0)
    out = generate(g, arcs, 0, 1, 1.0, base)
    labels = [c.label for c in out.candidates]
    assert any("best single path" in label for label in labels)
    single = next(c for c in out.candidates if "best single path" in c.label)
    assert single.n_arcs == 1


def test_conflicting_pools_are_detected():
    """Two arcs of the same pool cannot both carry flow (decision 3)."""
    arcs = [
        arc(0, POOL[0], 0, 1),
        arc(1, POOL[0], 0, 1, B=2.0),  # same pool, different arc
        arc(2, POOL[1], 0, 1, B=3.0),
    ]
    psi = np.array([1.0, 1.0, 1.0])
    conflicts = conflicting_pools(arcs, psi)
    assert list(conflicts) == [POOL[0].lower()]
    assert conflicts[POOL[0].lower()] == [0, 1]


def test_every_generated_candidate_is_conflict_free():
    """Repair happens inside the generator, so no candidate is wasted."""
    arcs = [
        arc(0, POOL[0], 0, 1, B=1.0),
        arc(1, POOL[0], 0, 1, B=1.5),  # same pool
        arc(2, POOL[1], 0, 1, B=2.0),
        arc(3, POOL[2], 0, 1, B=3.0),
    ]
    g = build(arcs)
    base = active_set_solve(g, 0, 1, 1.0)
    assert conflicting_pools(arcs, base.psi)  # the relaxation does conflict

    out = generate(g, arcs, 0, 1, 1.0, base)
    repaired = [c for c in out.candidates if c.kind != "base"]
    assert repaired
    for candidate in repaired:
        assert not conflicting_pools(arcs, candidate.psi), candidate.label


def test_pin_sweep_runs_on_flagged_arcs():
    """§6.3 -- and it must outrank drop candidates in the emitted order."""
    arcs = [
        arc(0, POOL[0], 0, 1, B=1.0, flagged=True),
        arc(1, POOL[1], 0, 1, B=2.0),
    ]
    g = build(arcs)
    g.cap = np.array([2.0, np.inf])
    base = active_set_solve(g, 0, 1, 1.0)
    out = generate(g, arcs, 0, 1, 1.0, base)

    labels = [c.label for c in out.candidates]
    pins = [k for k, label in enumerate(labels) if label.startswith("pin")]
    drops = [k for k, label in enumerate(labels) if label.startswith("drop")]
    assert pins, "a flagged active arc must be swept"
    if drops:
        assert min(pins) < min(drops)


def test_candidates_are_capped():
    arcs = [arc(k, POOL[k % 8], 0, 1, B=float(k + 1)) for k in range(8)]
    g = build(arcs)
    base = active_set_solve(g, 0, 1, 1.0)
    assert len(generate(g, arcs, 0, 1, 1.0, base, max_candidates=4)) <= 4


# --------------------------------------------------------------- verification


class FakeClient:
    """Returns a scripted output per route, so ranking can be tested exactly."""

    def __init__(self, outputs):
        self.outputs = outputs
        self.calls = 0

    def quote_routes(self, routes, amounts, slots):
        self.calls += 1
        return self.outputs[: len(routes)]


def _candidate(label, legs, out=None, status="ready"):
    from erouter.core.candidates import Candidate
    from erouter.core.realize import RealizedLeg, RealizedRoute
    from erouter.core.types import Leg

    route = RealizedRoute(dst_slot=1)
    for k in range(legs):
        route.legs.append(
            RealizedLeg(
                leg=Leg(POOL[0], ArcKind.SWAP_STABLE, src_slot=k, dst_slot=k + 1),
                kind=ArcKind.SWAP_STABLE, target=POOL[k % 8],
                token_in="0xa", token_out="0xb", amount_in=1, amount_out=1,
            )
        )
    candidate = Candidate(label=label, psi=np.array([1.0]), certificate=False)
    candidate.route = route
    candidate.status = status
    if out is not None:
        candidate.verified_out = out
    return candidate


def test_verify_drops_reverting_candidates():
    """§7 rule 4: a failed quote is arc removal, not an error."""
    candidates = CandidateSet([_candidate("a", 1), _candidate("b", 1)])
    verify(candidates, FakeClient([1000, 0]), amount_in=10**6)
    assert candidates.candidates[0].status == "ok"
    assert candidates.candidates[1].status == "reverted"
    assert candidates.best is candidates.candidates[0]


def test_all_candidates_go_out_in_one_call():
    candidates = CandidateSet([_candidate(str(k), 1) for k in range(8)])
    client = FakeClient([100 + k for k in range(8)])
    verify(candidates, client, amount_in=10**6)
    assert client.calls == 1  # the whole point of the quoter


def test_a_clearly_better_route_wins_regardless_of_length():
    candidates = CandidateSet([
        _candidate("short", 1),
        _candidate("long", 6),
    ])
    verify(candidates, FakeClient([1_000_000, 1_010_000]), amount_in=10**6)
    assert candidates.best.label == "long"  # 100 bp is worth the extra hops


def test_a_gain_smaller_than_the_gas_prefers_the_shorter_route():
    """Measured on mainnet: the relaxation takes a 25-leg route to gain
    0.02 bp over a 1-leg one.  A real gas price makes that strictly worse, and
    the price is what decides it -- the tolerance is one leg's gas in output
    units, not a constant standing in for it."""
    candidates = CandidateSet([
        _candidate("long", 25),
        _candidate("short", 1),
    ])
    verify(
        candidates,
        FakeClient([10**18 + 10**12, 10**18]),   # +0.01 bp for 24 more legs
        amount_in=10**18,
        gas_price_wei=30 * 10**9,
        dst_wei_per_eth=10**18,
    )
    assert candidates.best.label == "short"


def test_the_same_gain_is_taken_when_gas_is_nearly_free():
    """The other half, and the bug this replaced: at 0.05 gwei a flat tolerance
    threw away 0.04 bp on WETH->stETH -- a route ending in a 1:1 stETH mint,
    which cannot lose -- because 30x more gas than the trade would ever pay was
    assumed."""
    candidates = CandidateSet([
        _candidate("long", 4),
        _candidate("short", 2),
    ])
    verify(
        candidates,
        FakeClient([10**18 + 4 * 10**14, 10**18]),
        amount_in=10**18,
        gas_price_wei=int(0.049 * 10**9),
        dst_wei_per_eth=10**18,
    )
    assert candidates.best.label == "long"


def test_gas_price_penalises_extra_legs():
    candidates = CandidateSet([_candidate("short", 1), _candidate("long", 5)])
    # 5 legs cost ~600k gas; at 50 gwei that is 0.03 ETH of output
    verify(
        candidates,
        FakeClient([10**18, 10**18 + 10**16]),
        amount_in=10**18,
        gas_price_wei=50 * 10**9,
        dst_wei_per_eth=10**18,
    )
    assert candidates.best.label == "short"


def test_verify_is_a_no_op_without_ready_candidates():
    candidates = CandidateSet([_candidate("x", 1, status="conflict")])
    client = FakeClient([])
    verify(candidates, client, amount_in=1)
    assert client.calls == 0
    assert candidates.best is None


# ------------------------------------------------ ranking must not go stale


def test_reverifying_reassigns_every_rank():
    """The bug: `verify` used to return early when nothing needed quoting.

    It is called three times per route -- candidates, then the direct floor,
    then the refit -- and the winner is chosen *by rank*.  Returning early left
    ranks from an earlier call, including a rank of 1 that a solo verification
    had handed the refit candidate, so the router silently reported a route
    that was not the best one quoted.
    """
    a, b = _candidate("a", 1), _candidate("b", 1)
    candidates = CandidateSet([a, b])
    verify(candidates, FakeClient([1_000_000, 900_000]), amount_in=10**6)
    assert (a.rank, b.rank) == (1, 2)

    # a solo verification elsewhere hands `b` a rank of 1 ...
    b.rank = 1
    # ... and a re-verify with nothing new to quote must fix it
    verify(candidates, FakeClient([]), amount_in=10**6)
    assert (a.rank, b.rank) == (1, 2)
    assert candidates.best is a


def test_ranks_are_unique_and_contiguous():
    candidates = CandidateSet([_candidate(str(k), 1) for k in range(6)])
    verify(candidates, FakeClient([100, 700, 300, 0, 500, 200]), amount_in=10**6)
    ranks = sorted(c.rank for c in candidates.candidates if c.ok)
    assert ranks == list(range(1, len(ranks) + 1))
    assert all(c.rank is None for c in candidates.candidates if not c.ok)


def test_a_stale_rank_on_a_reverted_candidate_is_cleared():
    good, bad = _candidate("good", 1), _candidate("bad", 1)
    bad.rank = 1
    candidates = CandidateSet([good, bad])
    verify(candidates, FakeClient([1000, 0]), amount_in=10**6)
    assert bad.status == "reverted" and bad.rank is None
    assert candidates.best is good


def test_the_winner_is_never_worse_than_a_direct_swap():
    """The floor is enforced, not merely expected to fall out of the tie-break."""
    direct = _candidate("direct pool", 1)
    direct.kind = "direct"
    fancy = _candidate("clever 8-leg route", 8)
    candidates = CandidateSet([fancy, direct])
    # the multi-leg route quotes *worse* than the plain swap
    verify(candidates, FakeClient([900_000, 1_000_000]), amount_in=10**6)
    assert candidates.best is direct
    assert candidates.best.verified_out == 1_000_000


def test_repair_order_is_largest_flow_first():
    """The greedy choice is where the branch starts, not where it ends."""
    conflicts = {"poolA": [3, 1, 7]}
    psi = np.zeros(8)
    psi[3], psi[1], psi[7] = 0.2, 0.9, 0.5
    assert repair_order(conflicts, psi) == {"poolA": [1, 7, 3]}


def test_keep_only_walks_the_branch_and_clamps_past_the_end():
    """Each rank keeps a different arc; a rank past the end keeps the last.

    Clamping matters: `resolve` sweeps ranks until one re-solve is feasible, and
    falling off the end would raise rather than end the search.
    """
    ordered = {"poolA": [1, 7, 3]}
    for rank, kept in ((0, 1), (1, 7), (2, 3), (9, 3)):
        banned = np.zeros(8, bool)
        assert keep_only(banned, ordered, rank)
        assert not banned[kept]
        assert [k for k in (1, 7, 3) if banned[k]] == [k for k in (1, 7, 3) if k != kept]


def test_keep_only_never_bans_a_pinned_arc():
    """A pin is the candidate's whole point (§6.3), so the repair works around it."""
    banned = np.zeros(8, bool)
    keep_only(banned, {"poolA": [1, 7, 3]}, 0, pinned={7: 0.5})
    assert not banned[7] and not banned[1] and banned[3]


def test_keep_only_reports_when_it_has_no_move_left():
    """Nothing newly banned ends the repair instead of spinning a round on it."""
    ordered = {"poolA": [1, 7]}
    banned = np.zeros(8, bool)
    assert keep_only(banned, ordered, 0)          # bans arc 7
    assert not keep_only(banned, ordered, 0)      # already banned: no move left


def test_repair_recovers_a_candidate_whose_greedy_choice_was_infeasible():
    """The end-to-end shape, at the level `resolve` sees it.

    Pool A holds arcs 0, 1 and 2.  Banning down to the busiest (arc 0) leaves
    the flow with nowhere to go; the branch has to reach arc 2 before a
    re-solve succeeds.  Keeping only the greedy choice returns no candidate at
    all, which is how four sparse candidates were lost on crvUSD -> sDOLA
    at $2M.
    """
    conflicts = {"poolA": [0, 1, 2]}
    psi = np.array([0.77, 0.77, 0.16, 0.23, 0.07])
    ordered = repair_order(conflicts, psi)
    assert ordered["poolA"][0] in (0, 1)          # greedy picks one of the pair
    # Only keeping arc 2 leaves arcs 2, 3 and 4 usable -- the split that works.
    banned = np.zeros(5, bool)
    keep_only(banned, ordered, 2)
    assert list(np.flatnonzero(~banned)) == [2, 3, 4]
