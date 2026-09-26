"""How often a pool's own minimum-out would trip before the route lands.

Each leg carries a minimum-out at a fraction of the pool's fee; moving past it
between quote and inclusion reverts the leg.  Estimates `p` per arc -- per arc,
not per pool, since one pool's two rates need not move alike -- so
`core/risk.py` can price a route as `output * product(1 - p_i) - gas`.  Horizon
is two minutes: a wallet confirmation plus propagation.

Counting breaches directly cannot work at ~25 samples: zero events claims
"never", and Jeffreys smoothing puts an unbreached pool at 2%, or 22% over
twelve legs.  So the process is modelled as the data shows it, rates jumping on
trades rather than diffusing: `P(window contains a move) * P(a move exceeds the
bound)`, the first counted per arc, the second a shape pooled across the
universe from *nonzero* moves standardised by their own arc's scale, with a
Hill power-law tail.
"""

from __future__ import annotations

import math

from ..core.codec import encode_call
from ..core.transport import Call
from .drift import series_drift_bp

#: Twenty-five five-block steps: ~a minute apart over half an hour, ordered so
#: consecutive samples are adjacent in time.
STEP_BLOCKS = 5
SAMPLES = 25
FINE_BLOCKS = tuple(k * STEP_BLOCKS for k in range(SAMPLES))
#: Window width in steps: two minutes, the far end of a confirm-and-broadcast.
HORIZON = 2
#: The minimum-out, as a fraction of the pool's own fee.
BOUND_OF_FEE = 0.2
#: Absolute floor under that, for arcs whose rate really moves: a fee fraction
#: is unsurvivable where the fee is small against the pool's own volatility
#: (TricryptoUSDC: a 3.3 bp fee buys 0.65 bp against ~0.9 bp jumps).  5 bp sits
#: past the knee (1-2 bp) on purpose -- the estimate is noisy enough that a
#: floor at the knee would land on the wrong side of it half the time.  Must
#: match what the executor sets.  Applied only to `wide_bound_pools`; on a
#: pegged pair it would be a huge allowance.
BOUND_FLOOR_BP = 5.0
#: What counts as a pair whose rate moves, in bp over the ~4-hour drift series.
#: Not delicate: pegged pairs sit under 0.6, volatile ones above 4.  Measured
#: against the *pair* across every pool holding it -- a quiet pool looks pegged
#: whatever it trades.
PAIR_DRIFT_CUT_BP = 2.0
#: How often a fee-derived bound may trip before the pool is listed anyway.
#: The pair test is about the market, this one about the pool: an accruing
#: vault, a rebalance or an oracle step moves a pool's rate without the pair's.
TIGHT_TRIP_CUT = 0.01
#: Below this a rate is not moving as far as our own quotes can resolve.
SCALE_FLOOR_BP = 0.005
#: Never claim an arc is safer than this -- the tail is extrapolated past the
#: data.
RISK_FLOOR = 1e-5
RISK_CEILING = 0.95


def read_fees(client, pools) -> dict[str, float]:
    """Each pool's fee as a fraction, from the pool itself.

    Curve reports fees in units of 1e10.  A pool that does not answer is left
    out rather than defaulted: without its own fee there is no bound to measure
    against.
    """
    targets = [p.address for p in pools]
    calls = [Call(to=address, data=encode_call("fee()")) for address in targets]
    fees: dict[str, float] = {}
    for address, answer in zip(targets, client.raw(calls), strict=True):
        value = answer.uint_or(None) if answer.ok else None
        if value and 0 < value < 10**10:
            fees[address.lower()] = value / 1e10
    return fees


def moves_bp(rates: list[float], horizon: int = HORIZON) -> list[float]:
    """Absolute log moves over `horizon` samples, in basis points."""
    clean = [r for r in rates if r > 0]
    return [abs(math.log(clean[k] / clean[k + horizon])) * 1e4
            for k in range(len(clean) - horizon)]


def jump_scale_bp(moves: list[float]) -> float:
    """The size of a typical *move*, ignoring the windows with none.

    The median over all windows would be zero for most pools, which says only
    that most minutes are quiet.
    """
    jumps = sorted(m for m in moves if m > 0)
    if not jumps:
        return SCALE_FLOOR_BP
    return max(jumps[len(jumps) // 2], SCALE_FLOOR_BP)


def pair_drift_bp(series) -> dict[tuple[str, str], float]:
    """Worst drift per canonical pair, over every pool that holds it.

    Series keys carry the canonical pair already (`"tokenIn|tokenOut@pool"`), so
    this needs no node map.  Worst rather than deepest: a quiet pool's rate not
    moving says the pool saw no trades, not that the pair holds still.
    """
    out: dict[tuple[str, str], float] = {}
    for key, entry in series.items():
        pair, _, _pool = key.partition("@")
        left, _, right = pair.partition("|")
        both = (left, right) if left <= right else (right, left)
        out[both] = max(out.get(both, 0.0), series_drift_bp(list(entry.prices)))
    return out


def wide_bound_pools(series, fees: dict[str, float], tight: dict | None = None, *,
                     cut_bp: float = PAIR_DRIFT_CUT_BP,
                     trip_cut: float = TIGHT_TRIP_CUT,
                     floor_bp: float = BOUND_FLOOR_BP) -> dict[str, dict]:
    """Pools whose own fee does not buy them a survivable minimum-out.

    A fraction of the fee works nearly everywhere; the exceptions charge like a
    stablecoin venue and move like something else.  A pool already clearing the
    floor is never listed.  Two ways to qualify, both needed:

    * **its pair moves**, measured across every pool holding the pair.  One
      quiet pool over half an hour cannot answer this -- a per-arc version left
      156 arcs on volatile pairs holding sub-bp bounds.
    * **the tight bound was seen to trip**, catching a pool whose own rate
      wobbles more than its pair does.

    Returns `{address: {"fee_bp", "drift_bp", "tight_p", "pair"}}`, so the
    committed list says why a pool is on it and a human can disagree in a diff.
    """
    drift = pair_drift_bp(series)
    worst_tight: dict[str, float] = {}
    for key, entry in (tight or {}).items():
        address = key.split(":")[0]
        worst_tight[address] = max(worst_tight.get(address, 0.0), entry["p"])

    listed: dict[str, dict] = {}
    for key in series:
        pair, _, pool = key.partition("@")
        left, _, right = pair.partition("|")
        pool = pool.lower()
        fee = fees.get(pool)
        if fee is None or fee * BOUND_OF_FEE * 1e4 >= floor_bp:
            continue  # its own fee is enough
        both = (left, right) if left <= right else (right, left)
        moved = drift.get(both, 0.0)
        trips = worst_tight.get(pool, 0.0)
        if moved <= cut_bp and trips < trip_cut:
            continue
        prior = listed.get(pool)
        if prior is None or moved > prior["drift_bp"]:
            listed[pool] = {"fee_bp": round(fee * 1e4, 4),
                            "drift_bp": round(moved, 4),
                            "tight_p": round(trips, 6),
                            "pair": f"{left}|{right}"}
    return listed


def bound_bp(fee: float, wide: bool = False,
             floor_bp: float = BOUND_FLOOR_BP) -> float:
    """The minimum-out this arc executes with, in basis points.

    A fraction of the pool's fee, floored for pools on the exception list.
    `floor_bp` is a parameter so one sampled series can be scored against
    several candidate floors.
    """
    bound = fee * BOUND_OF_FEE * 1e4
    return max(bound, floor_bp) if wide else bound


def tail_model(standardised: list[float]):
    """P(Z > z) for a move's size in units of its arc's typical move.

    Empirical inside the sample, a power law past its edge.  The exponent is
    Hill's estimator on the top decile (mean log excess over the threshold is
    1/alpha), clamped: below 1.5 the tail is heavier than any market, above 8
    it is thinner than one, which would invent safety.
    """
    ordered = sorted((z for z in standardised if z > 0), reverse=True)
    n = len(ordered)
    if n < 40:  # not enough to say anything about a shape
        return lambda z: 1.0 if z <= 0 else min(1.0, 1.0 / (1.0 + z) ** 3)
    k = max(8, n // 10)
    threshold = ordered[k - 1]
    excess = [math.log(z / threshold) for z in ordered[:k] if z > threshold]
    mean_excess = sum(excess) / len(excess) if excess else 0.0
    alpha = min(max(1.0 / mean_excess if mean_excess > 0 else 4.0, 1.5), 8.0)
    p_threshold = k / n

    def tail(z: float) -> float:
        if z <= 0:
            return 1.0
        if z <= threshold:
            return sum(1 for x in ordered if x > z) / n
        return p_threshold * (z / threshold) ** -alpha

    return tail


def breach_risk(series, fees: dict[str, float], arcs=None, *, wide=(),
                horizon: int = HORIZON,
                floor_bp: float = BOUND_FLOOR_BP) -> dict[str, dict]:
    """Per-arc risk, from rate series and pool fees.

    `series` is what `drift.sample_rates` returns.  `arcs` is the list handed to
    it, entries `(key, pool, kind, i, j, n_coins, dx)`; it supplies the coin
    indices, so the answer is keyed by direction the way the minimum-out is.
    Without it the answer falls back to pool-level keys.

    Returns `{"address:i>j": {"p", "bound_bp", "scale_bp", "active", "n"}}`.
    """
    index = {entry[0]: (entry[1], entry[3], entry[4]) for entry in (arcs or [])}

    measured: list[tuple[str, str, float, list[float]]] = []
    pooled: list[float] = []
    for key, entry in series.items():
        pool = entry.pool.lower()
        if pool not in fees:
            continue
        moves = moves_bp(list(entry.prices), horizon)
        if len(moves) < 4:
            continue
        target, i, j = index.get(key, (pool, -1, -1))
        scale = jump_scale_bp(moves)
        measured.append((f"{target.lower()}:{int(i)}>{int(j)}", pool, scale, moves))
        pooled.extend(m / scale for m in moves if m > 0)

    tail = tail_model(pooled)
    out: dict[str, dict] = {}
    for key, pool, scale, moves in measured:
        bound = bound_bp(fees[pool], pool in wide, floor_bp)
        jumps = sum(1 for m in moves if m > 0)
        # How often a window contains a move at all.  Half an event stands in
        # for none: an arc that saw no trade in half an hour is quiet, not
        # frozen.
        active = max(jumps, 0.5) / len(moves)
        modelled = active * tail(bound / scale)
        # A move seen past the bound outranks any model of how likely one was.
        seen = sum(1 for m in moves if m > bound) / len(moves)
        risk = min(max(max(seen, modelled), RISK_FLOOR), RISK_CEILING)
        out[key] = {"p": round(risk, 6), "bound_bp": round(bound, 4),
                    "scale_bp": round(scale, 4), "active": round(active, 4),
                    "n": len(moves)}
    return out
