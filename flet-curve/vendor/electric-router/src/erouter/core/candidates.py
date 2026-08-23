"""Candidate generation (spec §6).

The solved flow is the optimum of a *relaxation*, and three things make it
unfit to quote directly:

* clamped arcs look bottomless, so §2.3 predicts they are preferentially
  filled rather than probed away;
* reference prices are fitted, so real dislocations read as free money and the
  solver spreads across dozens of arcs chasing them;
* a pool may end up carrying flow on two arcs, which a view-only quoter cannot
  evaluate because it cannot see its own earlier leg.

So the model chooses *which pools*, and the on-chain quote chooses *between
candidates*.  Every generator below is a cheap re-solve -- a rank-1 change to
the active set -- and the multicall adjudicates.

Priority order matters when the budget truncates.  The pin sweep outranks the
drop candidates because §13.1's chord regression is explicit that the active
set is *identical* across the endpoint allocations, so no drop-an-arc candidate
can find the interior optimum.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from .graph import ArcArrays
from .multiport import MultiPortError, element_of_arcs
from .quoter import MAX_LEGS, MAX_SLOTS
from .realize import RealizedRoute, cancel_cycles, prune_dust
from .seed import k_shortest_paths
from .solve import Solution, active_set_solve
from .types import PoolArc

# Sparsification levels.  The relaxation routinely activates dozens of arcs
# chasing fitted dislocations; these ask "what if you only had k pools?" and
# double as §11.1's gas-sparsification candidates.
TOP_K = (1, 2, 3, 4, 6, 8, 12)
PIN_LADDER = (0.0, 0.125, 0.25, 0.5, 1.0, 2.0, 4.0)
# An arc carrying less than this fraction of the trade cannot change the outcome,
# but chasing it costs pivots.  Candidates are heuristics adjudicated by the
# quoter, so they are solved to this screen; the certified base solve is not.
MIN_FLOW_FRACTION = 1e-4
# A candidate is realised into the quoter's slot accumulator, one slot per
# distinct token it touches.  A support wider than that cannot be priced no
# matter how good it is, so counting nodes is a cheap, sound rejection: the
# realised slot count is never *fewer* than the distinct nodes carrying flow.
#
# Predicting it from the relaxation's own width does not work.  The obvious
# argument -- pin/drop/repair perturb C0 by one arc, so they inherit its width --
# is false: forbidding an arc makes the re-solve find a different and sometimes
# far narrower support, and skipping those families cost 5.65 bp on a $100 swap.
# So a family is stopped only once it has actually produced this many
# unrealisable candidates in a row.
WIDE_STREAK = 2
# Candidates are heuristics; stopping early yields a feasible flow, not a
# broken one, and the quoter is what decides between them anyway.
CANDIDATE_PIVOTS = 60
# Repair rounds per candidate.  Three was enough while the repair only ever made
# one choice; branching to the next arc down spends a round each time it has to
# back out, and the deepest measured chain is three bans then two backtracks.
REPAIR_ROUNDS = 6


def repair_order(conflicts: dict, psi: np.ndarray) -> dict:
    """Each conflicting pool's arcs, the one carrying most first.

    Decision 3 allows a pool one arc per route, so a conflict is a choice of
    which to keep.  Largest-first is the order to try them in, not the answer.
    """
    return {pool: sorted(indices, key=lambda k: -psi[k])
            for pool, indices in conflicts.items()}


def keep_only(banned: np.ndarray, ordered: dict, rank: int, pinned=None) -> bool:
    """Ban every arc of each conflicting pool but the one at `rank`.

    `rank = 0` is the greedy choice; higher ranks are the rest of the branch.
    A rank past the end clamps, so a caller sweeping ranks cannot fall off.
    Returns whether anything was newly banned -- nothing banned means the
    repair has no move left to make and the caller must stop rather than loop.
    """
    applied = False
    for indices in ordered.values():
        keep = indices[min(rank, len(indices) - 1)]
        for k in indices:
            if k != keep and not (pinned and k in pinned) and not banned[k]:
                banned[k] = True
                applied = True
    return applied


@dataclass(slots=True)
class Candidate:
    label: str
    psi: np.ndarray
    certificate: bool
    reason: str = ""
    kind: str = "solve"
    n_arcs: int = 0
    modelled_loss: float = 0.0
    route: RealizedRoute | None = None
    verified_out: int | None = None
    status: str = "pending"
    note: str = ""
    rank: int | None = None
    gas: int = 0
    #: P(every leg's minimum-out holds until inclusion); 1.0 until priced.
    survival: float = 1.0

    @property
    def ok(self) -> bool:
        return self.status == "ok" and self.verified_out is not None


@dataclass(slots=True)
class CandidateSet:
    candidates: list[Candidate] = field(default_factory=list)
    skipped: int = 0
    #: How much solving this generation asked for.  Surfaced because it is
    #: what separates "the build got slower" from "this block is harder": the
    #: same pair and size runs 48 solves at one block and 113 at another.
    solves: int = 0
    pivots: int = 0
    # Node count of the relaxation when it was too wide for any perturbation of
    # it to be realisable; 0 when the pin/drop/repair families ran normally.
    skipped_wide: int = 0

    def __len__(self) -> int:
        return len(self.candidates)

    @property
    def best(self) -> Candidate | None:
        """The winner, by the rank `verify` assigned -- which is *not* simply
        the largest output: outputs within a hair of each other are the same
        answer, and the cheaper route to execute wins (§11.1)."""
        ranked = [c for c in self.candidates if c.ok and c.rank is not None]
        if ranked:
            return min(ranked, key=lambda c: c.rank)
        usable = [c for c in self.candidates if c.ok]
        return max(usable, key=lambda c: c.verified_out or 0) if usable else None


def _signature(psi: np.ndarray, tol: float = 1e-12) -> tuple:
    """Active set plus split rounded to 10 bp -- §6.2's dedup key."""
    total = psi.sum()
    if total <= 0:
        return ()
    return tuple(
        sorted(
            (int(k), round(float(psi[k] / total), 3))
            for k in np.flatnonzero(psi > tol)
        )
    )


def _pool_of(arcs: list[PoolArc]) -> np.ndarray:
    return np.array([a.pool.lower() for a in arcs], dtype=object)


def _by_new_pools(paths: list[list[int]], pools: np.ndarray) -> list[list[int]]:
    """Re-order paths so each one brings pools the earlier ones did not.

    The cheapest path stays first -- it is `C_*`, what a caller with no appetite
    for splitting gets.  After that, greedily take whichever remaining path adds
    the most unseen pools, breaking ties toward the cheaper one, so the
    cumulative unions grow in *venues* rather than in count.  Ordering only.
    """
    if len(paths) < 3:
        return paths
    pool_sets = [{pools[int(a)] for a in path} for path in paths]
    order = [0]
    seen = set(pool_sets[0])
    remaining = list(range(1, len(paths)))
    while remaining:
        pick = max(remaining, key=lambda i: (len(pool_sets[i] - seen), -i))
        remaining.remove(pick)
        order.append(pick)
        seen |= pool_sets[pick]
    return [paths[i] for i in order]


def _spread(top_k: tuple[int, ...], budget: int) -> set[int]:
    """The `k` levels to spend `budget` candidates on, across the whole ladder.

    Taking `top_k` in order spends everything on its dense low end -- with
    `(1, 2, 3, 4, 6, 8, 12)` and room for four, the widest union ever built is
    four paths.  Sampling evenly keeps `1` and reaches `12`.
    """
    levels = sorted(set(top_k))
    if budget >= len(levels) or budget <= 1:
        return set(levels)
    step = (len(levels) - 1) / (budget - 1)
    return {levels[round(i * step)] for i in range(budget)}


#: Flow below this share of the trade is not a decision the solve made -- it is
#: the residue of a pivot, and it differs in the last bits between one linear
#: kernel and another.  Testing `psi > 0` therefore made *membership* itself
#: kernel-dependent: an arc carrying 1e-18 counted as active under LU and not
#: under Cholesky, which changed which pools conflict, which changed the repair
#: candidates, which changed the ballot -- measured, by 72 bp.
#:
#: A floor relative to the trade makes the question "did the solve route anything
#: here" rather than "is this float positive".
ACTIVE_FLOOR = 1e-12


def carries(psi: np.ndarray, Psi: float) -> np.ndarray:
    """Arcs the solve actually routed through, as a boolean mask."""
    return psi > max(ACTIVE_FLOOR * abs(Psi), 0.0)


def conflicting_pools(arcs: list[PoolArc], psi: np.ndarray,
                      Psi: float = 0.0) -> dict[str, list[int]]:
    """Pools carrying flow on more than one arc whose arcs are not one element.

    The same rule `check_one_arc_per_pool` applies to realised legs, asked here
    of the arcs -- a coin holds at most one port, so `#in + #out <= N` and a
    2-coin pool cannot be entered twice.  Order does not exist yet at this
    stage and the rule does not need it: admissibility is a property of which
    ports are used, not of the sequence.

    """
    groups: dict[str, list[int]] = {}
    for k in np.flatnonzero(carries(psi, Psi) if Psi else psi > 0):
        groups.setdefault(arcs[int(k)].pool.lower(), []).append(int(k))
    out: dict[str, list[int]] = {}
    for pool, idx in groups.items():
        if len(idx) < 2:
            continue
        try:
            element_of_arcs([arcs[k] for k in idx])
        except (MultiPortError, ValueError):
            out[pool] = idx
    return out


def generate(
    g: ArcArrays,
    arcs: list[PoolArc],
    src: int,
    dst: int,
    Psi: float,
    base: Solution,
    *,
    base_certificate: bool = False,
    seed: np.ndarray | None = None,
    max_candidates: int = 20,
    top_k: tuple[int, ...] = TOP_K,
    gas_floor: float = 0.0,
    max_legs: int = MAX_LEGS,
    element_split=None,
) -> CandidateSet:
    out = CandidateSet()
    seen: set[tuple] = set()

    streak: dict[str, int] = {}

    def exhausted(kind: str) -> bool:
        """Has this family produced only unrealisable candidates lately?"""
        return streak.get(kind, 0) >= WIDE_STREAK

    def width(psi: np.ndarray) -> int:
        """Distinct nodes carrying flow -- a lower bound on realised slots."""
        live = carries(psi, Psi)
        if not live.any():
            return 0
        return int(np.unique(np.concatenate([g.tau[live], g.sig[live]])).size)

    def add(psi: np.ndarray, label: str, kind: str, certificate: bool, reason: str = "") -> bool:
        psi, _ = cancel_cycles(g.tau, g.sig, psi)
        # Before the dedup signature, so two candidates differing only by a
        # dust branch collapse into one instead of spending two verify slots.
        psi, _ = prune_dust(g.tau, g.sig, psi, src, dst)
        active = int(np.count_nonzero(psi > 0))
        if active == 0:
            return False
        key = _signature(psi)
        if not key or key in seen:
            return False
        seen.add(key)
        loss = float(np.sum(g.eps * psi) + np.sum(np.where(g.G > 0, psi**2 / (2 * g.G), 0.0)))
        out.candidates.append(
            Candidate(
                label=label, psi=psi, certificate=certificate, reason=reason,
                kind=kind, n_arcs=active, modelled_loss=loss,
            )
        )
        return True

    def resolve(forbidden: np.ndarray, label: str, kind: str, pinned=None) -> bool:
        """Re-solve, then repair pool conflicts rather than discarding them.

        Decision 3 allows a pool at most one arc per route, and the Laplacian
        knows nothing about that.  Repairing in place -- keep one arc, forbid its
        siblings, solve again -- turns what would be a wasted candidate into a
        usable one, and every generator gets it for free.

        **Which arc to keep is a branch, not a guess.**  Keeping the one carrying
        most is the right first try, but when the sibling it bans is the only
        thing joining src to dst in this restricted subgraph, the re-solve comes
        back "src not connected" and a candidate that had *already solved* is
        thrown away.  Measured on crvUSD -> sDOLA at $2M: four candidates died
        exactly this way -- every level of the path family above `k = 1`, the
        family that is connected by construction, plus `top 6 pools` -- leaving
        two solved candidates on the ballot.  The router fell back to dumping
        the whole trade through one pool at 212% of its reserve, 706 bp behind
        the route the branch finds.
        So on an infeasible repair, put the bans back and keep the next arc down.
        """
        banned = forbidden.copy()
        # (bans before the repair, arcs per conflicting pool, which one we kept)
        undo: tuple[np.ndarray, dict, int] | None = None
        for _ in range(REPAIR_ROUNDS):
            # One warm-started active-set solve, not column generation.  The
            # base solve already priced out all m arcs, so a candidate is a small
            # perturbation of a known optimum: re-deriving the support from
            # scratch costs ~150 pivots and buys nothing, since a restricted
            # candidate cannot be certified anyway.
            out.solves += 1
            solution = active_set_solve(
                g, src, dst, Psi, A0=warm, forbidden=banned, forced_upper=pinned,
                # §11.1: gas cannot enter the objective without making the
                # program mixed-integer, but it bounds it from outside.  An arc
                # carrying less value than its leg costs to execute cannot pay
                # for itself even if it were pure profit, so screening it out is
                # sound rather than heuristic.
                min_flow=MIN_FLOW_FRACTION * Psi,
                gas_cost=gas_floor,
                maxit=CANDIDATE_PIVOTS, partial_ok=True,
            )
            out.pivots += solution.pivots
            if not solution.feasible:
                if undo is None:
                    return False
                before, ordered, rank = undo
                rank += 1
                if rank >= max(len(v) for v in ordered.values()):
                    return False
                banned = before.copy()
                keep_only(banned, ordered, rank, pinned)
                undo = (before, ordered, rank)
                continue
            conflicts = conflicting_pools(arcs, solution.psi)
            if not conflicts:
                break
            ordered = repair_order(conflicts, solution.psi)
            before = banned.copy()
            if not keep_only(banned, ordered, 0, pinned):
                return False
            undo = (before, ordered, 0)
        else:
            return False
        # Two ways to be unrealisable, and both are known before realising:
        # more distinct tokens than the quoter has slots, or more arcs than the
        # caller will accept legs (each arc is at least one leg).
        support = int(np.count_nonzero(solution.psi > 0))
        if width(solution.psi) > MAX_SLOTS or support > max_legs:
            # Solved, and unrealisable.  Adding it would spend a realise and a
            # slot in the verification batch to learn what the node count
            # already said.
            out.skipped += 1
            streak[kind] = streak.get(kind, 0) + 1
            return False
        streak[kind] = 0
        return add(solution.psi, label, kind, False, "RESTRICTED")

    # 1. the relaxation itself
    add(base.psi, "C0 full", "base", base_certificate)

    pools = _pool_of(arcs)
    base_active = np.flatnonzero(carries(base.psi, Psi))
    # Warm-start from the *circulation-free* support.  The raw optimum carries
    # flow on arcs that only exist to go round a negative-eps loop; they are
    # cancelled before execution anyway, and leaving them in the start set makes
    # every candidate re-solve churn through them again.
    acyclic, _ = cancel_cycles(g.tau, g.sig, base.psi)
    warm = np.flatnonzero(acyclic > 0)
    if warm.size == 0:
        warm = base_active

    # Per-family budgets.  Ordering alone is not enough: with many flagged arcs
    # the pin sweep alone is 3 x 7 = 21 candidates, which used to consume the
    # whole budget before sparsification ran.  Every un-sparsified candidate
    # inherits the relaxation's sprawl and blows the quoter's leg limit -- on a
    # 5M swap, *all twenty* came back too_long and the router fell back to a
    # single pool.
    sparse_budget = max(6, int(max_candidates * 0.45))
    pin_budget = max(4, int(max_candidates * 0.30))
    # Split the sparse budget between its two families.  They answer different
    # questions -- a union of the cheapest *paths*, versus the *pools* the
    # relaxation actually put flow through -- and one shared counter let the first
    # starve the second, because paths run first and there are more of them.
    # Measured on USDC->sUSDS 1M, the pool family's winner was never generated and
    # the route came out 48.8 bp short of it.  Paths keep first claim, since they
    # are the family that reliably fits the quoter's leg limit.
    path_budget = max(3, sparse_budget // 2)

    # 2. sparsification, over the k cheapest *paths* rather than the k largest
    #    arcs.  Restricting to arbitrary arcs usually leaves src and dst
    #    disconnected and the re-solve is infeasible; a union of shortest paths
    #    is connected by construction.  `k = 1` is §6.2's `C_*`, the
    #    no-splitting fallback, and the ladder doubles as §11.1's gas move --
    #    it is also the only family that reliably fits the quoter.
    made_paths = 0
    paths = k_shortest_paths(g, src, dst, k=max(top_k) if top_k else 6)
    # Yen's returns *near-duplicates*: the same route with one hop swapped, in
    # eps order.  Taking them in that order makes each union differ from the last
    # by a single arc, so a budget of four buys four nested sets covering the same
    # handful of pools, and the loop stops long before the ladder's wide end.
    # Measured on USDC -> crvUSD at $5M, the 9th path -- the one through 3pool
    # that Curve's own router takes -- was never on the ballot, and whether it
    # made the top four moved with the block.
    #
    # So: order the paths so each brings pools the earlier ones did not, and
    # spread the budget across the whole ladder instead of consuming it at the
    # dense low end.  `k = 1` stays first either way: it is §6.2's `C_*`, and the
    # candidate that reliably fits the quoter.
    paths = _by_new_pools(paths, pools)
    levels = _spread(top_k, path_budget)
    union: set[int] = set()
    for k, path in enumerate(paths, start=1):
        union.update(int(a) for a in path)
        if k not in levels:
            continue
        forbidden = np.ones(g.m, bool)
        for index in union:
            forbidden[index] = False
        label = "C* best single path" if k == 1 else f"top {k} paths"
        made_paths += bool(resolve(forbidden, label, "sparse"))
        if made_paths >= path_budget:
            break

    # 2b. keep only the pools the relaxation liked best, but let the solver use
    #     any arc of those pools so it can still find a connected route.
    order = sorted(base_active, key=lambda k: -base.psi[k])
    ranked_pools: list[str] = []
    for k in order:
        if pools[k] not in ranked_pools:
            ranked_pools.append(pools[k])
    pool_budget = max(3, sparse_budget - made_paths)
    made_pools = 0
    for k in top_k:
        if k >= len(ranked_pools) or made_pools >= pool_budget:
            continue
        keep = set(ranked_pools[:k])
        forbidden = np.array([pool not in keep for pool in pools], dtype=bool)
        made_pools += bool(resolve(forbidden, f"top {k} pool{'s' if k > 1 else ''}", "sparse"))

    out.skipped_wide = width(base.psi)

    # 3. pin sweep on every active flagged arc (§6.3).  Still ahead of the drop
    #    candidates, because no drop candidate can find a chord interior.
    #
    #    Arcs of a **re-entered pool** join the sweep, and this is the whole
    #    treatment reentry gets in the solver.  Two arcs of one pool are two
    #    independent resistors here: separate `psi^2/2G` terms, no cross-term,
    #    both calibrated at a state neither will see, because the first leg moves
    #    the pool before the second arrives.  The honest fix is a dense Hessian
    #    block per pool, which the diagonal the §5.5 certificate prices out
    #    against does not admit.
    #
    #    So do what §6.3 already does for a chord: stop trusting the model for the
    #    *allocation*, sweep it, and let a real quote adjudicate.  The walk prices
    #    each pin with the pool actually advanced between legs (`_stateful_leg`).
    #    Co-activity is only known after the solve, which is why this is here and
    #    not in the arc flags.
    made = 0
    swept = {int(k) for k in base_active if g.flagged[k]}
    live_pools = {pools[int(k)] for k in base_active}
    # Every arc of a pool the route touches, not only the ones carrying flow:
    # the sweep wants the co-active ones, and the element generator below
    # wants the idle siblings too.
    by_pool: dict[str, list[int]] = {}
    for k in range(len(arcs)):
        if pools[k] in live_pools:
            by_pool.setdefault(pools[k], []).append(k)
    active_by_pool: dict[str, list[int]] = {}
    for k in base_active:
        active_by_pool.setdefault(pools[int(k)], []).append(int(k))
    for shared in active_by_pool.values():
        if len(shared) > 1:
            swept.update(shared)
    flagged_active = sorted(swept)
    for arc_index in flagged_active[:3]:
        star = float(base.psi[arc_index])
        for step in PIN_LADDER:
            pin = min(star * step, float(g.cap[arc_index]))
            if step > 0 and pin <= 0:
                continue
            made += bool(
                resolve(
                    np.zeros(g.m, bool),
                    f"pin {arcs[arc_index].note[:18]} x{step:g}",
                    "pin",
                    pinned={arc_index: pin},
                )
            )
            if made >= pin_budget or len(out) >= max_candidates or exhausted("pin"):
                break
        if made >= pin_budget or len(out) >= max_candidates or exhausted("pin"):
            break

    # 3b. multi-port elements (docs/multi-port-elements.md, step 2).
    #
    #     Where one pool pays two ports out of one coin, the split between
    #     them is not something the model can rank: they are two independent
    #     resistors here, and the second was calibrated against a pool the
    #     first has already moved.  The sweep above brackets that.  An element
    #     *solves* it -- `best_split` advances the pool between legs, which is
    #     the arithmetic that matches execution -- so its answer is pinned as
    #     one more candidate and ranked on measured output like everything
    #     else.
    #
    #     Pinned rather than forced: `resolve` takes these as `forced_upper`,
    #     so the solver may take less than the element asked for.  That can
    #     only improve the candidate, and it means a bad split cannot make a
    #     route worse than the unpinned solve already was.
    #
    #     `element_split` is supplied by the caller because pricing needs a
    #     pool model and this module is pure -- it holds `a` and `B`, not a
    #     `StableSwap`.  Absent, nothing here runs.
    #     Pairs are proposed **speculatively**, not read off the base solve.
    #     Gating on "the solver already went through this pool twice" makes
    #     the generator unable to reach the case it was built for: gnosis
    #     WXDAI -> EURe runs 100% down one arm, so no pool is co-active, so no
    #     element is offered, so the second arm is never priced.  Both ports
    #     have to be on the table before either can win.  So an active arc is
    #     paired with its idle siblings -- same pool, same input coin -- and
    #     the candidate competes on measured output like any other.
    if element_split is not None:
        pairs: list[tuple[int, int]] = []
        active_set = {int(k) for k in base_active}
        for shared in by_pool.values():
            live = [k for k in shared if k in active_set]
            for k1 in live:
                for k2 in shared:
                    if k2 != k1 and arcs[k1].tau == arcs[k2].tau:
                        pairs.append((k1, k2) if k1 < k2 else (k2, k1))
        for k1, k2 in dict.fromkeys(pairs):
            if len(out) >= max_candidates or exhausted("element"):
                break
            try:
                tuned = element_split(arcs[k1], arcs[k2],
                                      float(base.psi[k1]), float(base.psi[k2]))
            except Exception:
                tuned = None      # a pricer that cannot answer is not an error
            if not tuned:
                continue
            psi1, psi2 = tuned
            if psi1 <= 0 or psi2 <= 0:
                continue
            resolve(np.zeros(g.m, bool),
                    f"element {arcs[k1].note[:16]} {psi1 / (psi1 + psi2):.0%}",
                    "element", pinned={k1: psi1, k2: psi2})

    # 4. one arc per pool (decision 3) -- keep the largest, forbid the rest
    conflicts = conflicting_pools(arcs, base.psi, Psi)
    if conflicts:
        forbidden = np.zeros(g.m, bool)
        for indices in conflicts.values():
            keep_index = max(indices, key=lambda k: base.psi[k])
            for k in indices:
                if k != keep_index:
                    forbidden[k] = True
        resolve(forbidden, f"repair {len(conflicts)} pool conflict(s)", "repair")

        # There is no "re-enter this pool anyway" candidate any more, and none
        # is needed: `conflicting_pools` only reports a pool whose arcs are not
        # an admissible element, so a legal element was never a conflict and
        # never had to be repaired around.  The gnosis split -- swap through the
        # 3pool, then deposit into it -- is a 1-in-2-out element and survives
        # the base solve untouched.
        worst = max(conflicts.items(), key=lambda kv: len(kv[1]))
        for keep_index in sorted(worst[1], key=lambda k: -base.psi[k])[1:2]:
            alt = np.zeros(g.m, bool)
            for k in worst[1]:
                if k != keep_index:
                    alt[k] = True
            resolve(alt, f"repair alt {arcs[keep_index].note[:18]}", "repair")

    # 5. drop each active arc in turn (§6.2)
    for k in order[: max(0, max_candidates - len(out))]:
        forbidden = np.zeros(g.m, bool)
        forbidden[k] = True
        resolve(forbidden, f"drop {arcs[int(k)].note[:20]}", "drop")
        if len(out) >= max_candidates or exhausted("drop"):
            break

    out.candidates = out.candidates[:max_candidates]
    return out
