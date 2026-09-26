"""Probe planning: turn arcs into a batch of quote requests (spec §2.3).

A *geometric grid* rather than the bare 4-node ladder, because it costs the
same one round trip and does strictly more:

* `a` can be taken from the smallest node that actually answered.  Measured on
  Ethereum, 6% of arcs fail at `1e-6 * reserve` -- 41 revert, 6 return empty,
  and 7 return **zero**, which is the dangerous one because a zero `a` looks
  valid and then poisons `log a` in the reference-price fit.
* second divided differences fall out on *every* consecutive triple, a stronger
  non-concavity detector than one ladder.
* the stableswap peg boundary shows up as a jump in local curvature, so §2.5's
  arc split becomes a measurement rather than a hope that `d_bar` happened to
  land inside the flat region.

Token decimals in the live universe are `{18: 680, 6: 158, 8: 49, 2: 5, 9: 2}`
-- two-decimal tokens exist, so deltas are floored and de-duplicated in integer
space rather than assuming 1e-6 of a reserve is a meaningful amount.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from .types import ArcKind, Probe, ProbeLadder

GRID: tuple[float, ...] = (1e-6, 1e-4, 1e-3, 1e-2, 3e-2, 1e-1)

# §2.6's probe economy.  Pricing out every arc -- which is what the §5.5
# certificate rests on -- needs only `eps`, hence only `a`.  `B` is needed only
# where flow actually goes.  So the whole universe gets a two-point pass, and
# the full ladder is spent on the arcs that could carry something.
#
# Two points plus the free origin still give a real curvature estimate (one
# second divided difference), so nothing is bootstrapped from TVL; it is just
# coarser than the arcs that get refined.
COARSE_GRID: tuple[float, ...] = (1e-4, 1e-2)
# Sizes to fall back to when a coarse probe fails -- 6% of arcs do, and a few
# return zero, which is worse because it looks like a valid quote.
RETRY_GRID: tuple[float, ...] = (1e-3, 3e-2, 1e-1)

# Where the refine pass samples, as fractions of *the trade* rather than of the
# pool's reserve.  The quadratic is a local model, so it should be fitted where
# the flow is going to land, not near zero: measured against the chain, the
# reserve-sized grid was off by five and six figures of basis points on shallow
# pools, where `1e-6 .. 1e-1 * reserve` samples three orders below the operating
# point, while these three points came within 0.1 bp.
#
# Three is enough: with the free origin they give `a` from the smallest node, `B`
# from a secant at the largest, and two second divided differences -- every
# quantity the solve consumes.  Only `eta` needs more, and `eta` is a diagnostic.
TRADE_GRID: tuple[float, ...] = (0.05, 0.10, 0.20)


@dataclass(frozen=True, slots=True)
class ArcRef:
    """Everything needed to probe one direction of one pool."""

    pool: str
    kind: ArcKind
    i: int
    j: int
    n_coins: int
    reserve_in: int
    decimals_in: int = 18
    decimals_out: int = 18
    # What stands on the other side, used to keep the smallest probe above the
    # output token's own resolution; see `plan_deltas`.
    reserve_out: int = 0

    @property
    def id(self) -> str:
        return f"{self.pool.lower()}:{int(self.kind)}:{self.i}>{self.j}"


#: The fewest units of the output token a probe's answer may consist of.
#
# Quotes come back as integers, so an answer of `n` units carries a rounding error
# of `1/n`.  The curvature a ladder is trying to measure is often 1e-4 or smaller,
# so an answer of a few thousand units is *all* rounding -- measured on 3Crv ->
# GUSD, whose two decimals made a healthy stableswap look like it had increasing
# returns, clamping the arc and making $10,000 unroutable.
#
# Ten thousand units puts the rounding at 1e-4, below most real curvature.  It
# costs nothing on an 18-decimal token and moves the small end of the ladder
# outward exactly where the token is coarse.
MIN_OUT_QUANTA = 10_000


def plan_deltas(
    reserve_in: int,
    decimals_in: int = 18,
    grid: tuple[float, ...] = GRID,
    reserve_out: int = 0,
) -> list[int]:
    """Integer probe sizes, floored and strictly increasing.

    A node that would round onto its predecessor is dropped rather than sent:
    two identical deltas produce a zero denominator in the divided differences.

    The floor is whichever is larger: a size the *input* token can express, or
    a size whose answer the *output* token can express.  The second needs the
    far reserve, since a probe returns roughly `delta * reserve_out /
    reserve_in` -- first order, which is all a floor needs.
    """
    floor = max(1, 10 ** max(0, decimals_in - 6))
    if reserve_out > 0:
        # Rounded up: flooring here lands one unit short of the target.
        floor = max(floor, -(-MIN_OUT_QUANTA * reserve_in // reserve_out))
    out: list[int] = []
    for fraction in grid:
        delta = max(int(reserve_in * fraction), floor)
        if out and delta <= out[-1]:
            continue
        out.append(delta)
    return out


@dataclass(slots=True)
class ProbePlan:
    probes: list[Probe] = field(default_factory=list)
    arcs: list[ArcRef] = field(default_factory=list)
    deltas: list[list[int]] = field(default_factory=list)
    spans: list[tuple[int, int]] = field(default_factory=list)

    def __len__(self) -> int:
        return len(self.probes)


def plan_grid(arcs: list[ArcRef], grid: tuple[float, ...] = GRID) -> ProbePlan:
    """One batch covering every arc's whole ladder."""
    plan = ProbePlan()
    for arc in arcs:
        deltas = plan_deltas(arc.reserve_in, arc.decimals_in, grid, arc.reserve_out)
        if len(deltas) < 2:  # too little room to fit even a curvature estimate
            continue
        start = len(plan.probes)
        for delta in deltas:
            plan.probes.append(Probe(arc.pool, arc.kind, arc.i, arc.j, arc.n_coins, delta))
        plan.arcs.append(arc)
        plan.deltas.append(deltas)
        plan.spans.append((start, len(plan.probes)))
    return plan


@dataclass(slots=True)
class Ladder:
    """One arc's successful probes, ready for `calibrate`."""

    arc: ArcRef
    deltas: list[int] = field(default_factory=list)
    quotes: list[int] = field(default_factory=list)
    attempted: int = 0
    failures: dict[str, int] = field(default_factory=dict)

    @property
    def ok(self) -> bool:
        # Two successful probes plus the free origin are enough for `a` and a
        # curvature estimate; the coarse pass deliberately stops there.
        return len(self.deltas) >= 2

    @property
    def coarse_tangent(self) -> bool:
        """True when the smallest answering probe was not small.

        `a` is then a chord over a wide interval rather than a tangent, which
        under-states the marginal rate -- the conservative direction, but worth
        recording so §12.1 can see it.
        """
        if not self.deltas or self.arc.reserve_in <= 0:
            return False
        return self.deltas[0] > 1e-3 * self.arc.reserve_in

    def as_float(self) -> tuple[list[float], list[float]]:
        """Human units, which is the frame `a` and `B` are calibrated in."""
        scale_in = 10.0**self.arc.decimals_in
        scale_out = 10.0**self.arc.decimals_out
        return (
            [d / scale_in for d in self.deltas],
            [q / scale_out for q in self.quotes],
        )

    def provenance(self, block: int) -> ProbeLadder:
        return ProbeLadder(
            deltas=tuple(self.deltas),
            quotes=tuple(self.quotes),
            reserve_in=self.arc.reserve_in,
            decimals_in=self.arc.decimals_in,
            decimals_out=self.arc.decimals_out,
            block=block,
        )


def plan_refine(
    ladders: list[Ladder], keep: set[str], grid: tuple[float, ...] = GRID
) -> ProbePlan:
    """Plan the ladder points still missing on the arcs worth refining.

    Only the sizes not already probed are requested, so the coarse pass is
    reused rather than repeated.
    """
    plan = ProbePlan()
    for ladder in ladders:
        arc = ladder.arc
        if arc.id not in keep:
            continue
        have = set(ladder.deltas)
        wanted = [d for d in plan_deltas(arc.reserve_in, arc.decimals_in, grid) if d not in have]
        if not wanted:
            continue
        start = len(plan.probes)
        for delta in wanted:
            plan.probes.append(Probe(arc.pool, arc.kind, arc.i, arc.j, arc.n_coins, delta))
        plan.arcs.append(arc)
        plan.deltas.append(wanted)
        plan.spans.append((start, len(plan.probes)))
    return plan


def plan_sized(ladders: list[Ladder], sizes: dict[str, list[int]]) -> ProbePlan:
    """Probe explicit per-arc sizes, skipping anything already measured.

    `sizes` maps arc id to wei amounts of that arc's *input* token.  The caller
    owns the sizing because only it knows the trade: `plan_deltas` can see a
    reserve and nothing else.
    """
    plan = ProbePlan()
    for ladder in ladders:
        arc = ladder.arc
        want = sizes.get(arc.id)
        if not want:
            continue
        have = set(ladder.deltas)
        floor = max(1, 10 ** max(0, arc.decimals_in - 6))
        fresh: list[int] = []
        for delta in sorted({max(int(d), floor) for d in want}):
            if delta not in have and delta not in fresh:
                fresh.append(delta)
        if not fresh:
            continue
        start = len(plan.probes)
        for delta in fresh:
            plan.probes.append(Probe(arc.pool, arc.kind, arc.i, arc.j, arc.n_coins, delta))
        plan.arcs.append(arc)
        plan.deltas.append(fresh)
        plan.spans.append((start, len(plan.probes)))
    return plan


def merge(ladders: list[Ladder], extra: list[Ladder]) -> list[Ladder]:
    """Fold refinement results into the coarse ladders, keeping sizes sorted."""
    by_id = {lad.arc.id: lad for lad in ladders}
    for more in extra:
        base = by_id.get(more.arc.id)
        if base is None or not more.deltas:
            continue
        pairs = sorted(
            {**dict(zip(base.deltas, base.quotes, strict=True)),
             **dict(zip(more.deltas, more.quotes, strict=True))}.items()
        )
        base.deltas = [d for d, _ in pairs]
        base.quotes = [q for _, q in pairs]
        base.attempted += more.attempted
        for key, count in more.failures.items():
            base.failures[key] = base.failures.get(key, 0) + count
    return ladders


def collect(plan: ProbePlan, results) -> list[Ladder]:
    """Group quote results back into per-arc ladders, dropping failures.

    A failed probe is dropped, never recorded as a zero: `a = 0` would look
    like a valid quote and NaN the reference-price fit.
    """
    ladders: list[Ladder] = []
    for arc, deltas, (lo, hi) in zip(plan.arcs, plan.deltas, plan.spans, strict=True):
        ladder = Ladder(arc=arc, attempted=hi - lo)
        for delta, result in zip(deltas, results[lo:hi], strict=True):
            status = getattr(result, "status", None)
            value = int(getattr(result, "value", 0) or 0)
            if status is not None and status.name != "VALUE":
                ladder.failures[status.name] = ladder.failures.get(status.name, 0) + 1
                continue
            if value <= 0:
                ladder.failures["ZERO"] = ladder.failures.get("ZERO", 0) + 1
                continue
            ladder.deltas.append(delta)
            ladder.quotes.append(value)
        ladders.append(ladder)
    return ladders
