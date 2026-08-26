"""Exact per-leg curves, sampled from the chain rather than fitted (§7).

The §2 element law has to be a quadratic: the solver is a convex QP over ~900
arcs and needs `f''` frozen to stay one.  Once a route is realised the topology
is fixed and there are a dozen legs, so there is no reason to keep paying the
`O(theta^2)` Taylor error -- a dense sample of the true `f` is affordable there,
and exact by construction.

What makes it affordable is that these probes are *independent*.  A chained
route quote forces a round trip per iteration, since leg `k`'s input is leg
`k-1`'s output; sampling one pool at 24 sizes does not chain at all, so a whole
route's curves are one `probe_batch` -- the same transport that already carries
~5,600 grid points for the entire universe.  Composition then happens in Python,
where an evaluation costs microseconds and the optimiser can run to convergence
instead of being shaped by a batch budget.

**Interpolate `u = x / f(x)`, not `f`.**  Measured, not assumed; the second
reason is the load-bearing one:

* *Accuracy.*  A cubic through 24 log-spaced samples of `f` reproduces a plain
  CPMM to 0.74 bp -- the same order as the effect being optimised, so useless.
  In `u` -- input per unit output, the average inverse price -- that same curve
  is **exactly affine**, since `x/f(x) = (R_in + x(1-fee)) / (R_out(1-fee))`.
  Stableswap and CryptoSwap are not affine there but are far flatter in `u`.
* *Monotonicity, structurally.*  With `u` linear on a node interval,
  `f' = (u - x u') / u^2` has **constant sign** across it, positive exactly when
  `s <= u_k / x_k` -- algebraically the same statement as `f(x_k+1) >= f(x_k)`.
  So the interpolant is monotone if and only if the probes are.  It cannot
  invent a region where trading more returns less, which is the failure an
  optimiser hunts for and walks into, and it cannot overshoot a saturation wall
  it was never shown above.

A monotone cubic (PCHIP) buys nothing over this and costs the guarantee: it
keeps *`u`* monotone, which does not bound `f` between the nodes.  On a measured
LLAMMA wall it invented an output 54% above anything the chain ever returned.

Below the first probe the curve is the chord through the origin, which is `a` --
the same tangent-as-chord the coarse ladder already reports.  Above the last,
`u` continues along its final secant, so `f` saturates rather than running away.
"""

from __future__ import annotations

from bisect import bisect_right
from dataclasses import dataclass

import numpy as np

# Nodes per leg, and the span they cover below the leg's maximum input.  A leg's
# input moves over decades as its weight sweeps the simplex, and what the
# optimiser needs resolved is the marginal rate, a relative quantity -- so the
# grid is geometric.
NODES = 24
SPAN = 4096.0


class CurveError(ValueError):
    pass


@dataclass(frozen=True, slots=True)
class Curve:
    """One leg's output as a function of its input, through sampled points.

    Stored as `u = x / f(x)` on the probe sizes, interpolated linearly.
    `rate0 = f(x0) / x0` closes the gap below the first probe.
    """

    x: tuple[float, ...]
    u: tuple[float, ...]
    slope: tuple[float, ...]
    rate0: float
    tail: float

    @property
    def top(self) -> float:
        return self.x[-1]

    def at(self, v: float) -> float:
        """Scalar evaluation.  Hot: the optimiser calls this millions of times."""
        if v <= 0.0:
            return 0.0
        x = self.x
        if v <= x[0]:
            return v * self.rate0
        if v >= x[-1]:
            inverse = self.u[-1] + (v - x[-1]) * self.tail
        else:
            k = bisect_right(x, v) - 1
            inverse = self.u[k] + (v - x[k]) * self.slope[k]
        return v / inverse if inverse > 0.0 else 0.0

    def __call__(self, v):
        values = np.asarray(v, dtype=float)
        if values.ndim == 0:
            return self.at(float(values))
        return np.array([self.at(float(one)) for one in values.ravel()]).reshape(values.shape)

    def error_bp_at(self, v: float) -> float:
        """Estimated interpolation error at `v`, in basis points, from the data.

        Linear interpolation of `u` is off by about `h^2 |u''| / 8`, and a
        relative error in `u` is one in `f = x/u`.  `u''` comes from the
        neighbouring secants, so this costs no extra probes -- which is what
        lets the caller refine only the legs that need it.
        """
        x, slope, u = self.x, self.slope, self.u
        if v <= x[0]:
            return 0.0
        if v >= x[-1] or len(slope) < 2:
            return float("inf")  # extrapolating, or too few nodes to tell
        k = bisect_right(x, v) - 1
        mid = min(max(k, 1), len(slope) - 1)
        second = 2.0 * (slope[mid] - slope[mid - 1]) / (x[mid + 1] - x[mid - 1])
        h = x[k + 1] - x[k]
        here = u[k] + (v - x[k]) * slope[k]
        if not (here > 0.0):
            return float("inf")
        return 0.125 * h * h * abs(second) / here * 10_000.0


def fit(deltas, quotes) -> Curve:
    """Build the interpolant of `x / f(x)` through the probes."""
    xs = np.asarray(deltas, dtype=float)
    ys = np.asarray(quotes, dtype=float)
    if xs.ndim != 1 or xs.shape != ys.shape:
        raise CurveError("sizes and quotes must be 1-D and the same length")
    if xs.size < 2:
        raise CurveError(f"need at least 2 probes, got {xs.size}")
    if not np.all(np.diff(xs) > 0):
        raise CurveError("probe sizes must be strictly increasing")
    if not np.all(xs > 0):
        raise CurveError("probe sizes must be positive")
    if not np.all(ys > 0):
        raise CurveError("quotes must be positive; drop failed probes first")

    us = xs / ys
    slope = np.diff(us) / np.diff(xs)
    # Never extrapolate a *falling* `u`.  A final secant with increasing returns
    # -- a dynamic fee shrinking with size, §11.2's CryptoSwap-NG case -- would
    # drive `u` to zero and then negative, and `f = x/u` through the roof and
    # then off a cliff.  Holding `u` flat continues the last average rate
    # instead, which is §2.3's chord: an over-estimate, hence the side that
    # cannot prune the true optimum.
    tail = max(0.0, float(slope[-1]))
    return Curve(
        tuple(map(float, xs)),
        tuple(map(float, us)),
        tuple(map(float, slope)),
        float(ys[0] / xs[0]),
        tail,
    )


def linear(rate: float) -> Curve:
    """`f(x) = rate * x`, for a leg that is a conversion rather than a trade."""
    if not (rate > 0):
        raise CurveError(f"rate must be positive, got {rate!r}")
    return Curve((1.0, 2.0), (1.0 / rate, 1.0 / rate), (0.0,), rate, 0.0)


def sizes(top: float, *, nodes: int = NODES, span: float = SPAN) -> list[int]:
    """Log-spaced integer probe sizes up to `top`, strictly increasing.

    A node that would round onto its predecessor is dropped rather than sent --
    two equal sizes are a zero denominator in the secant, and on a 2-decimal
    token the bottom of the ladder collides hard.
    """
    if top < 2:
        return []
    lo = max(1.0, top / span)
    out: list[int] = []
    for value in np.geomspace(lo, top, nodes):
        node = max(1, int(value))
        if out and node <= out[-1]:
            continue
        out.append(node)
    return out
