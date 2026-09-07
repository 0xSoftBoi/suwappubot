"""Synthetic pools with exactly known derivatives.  Pure Python, no chain.

Everything here exposes `f(delta)` and its true `a`/`B`, so calibration can be
checked against ground truth rather than against itself.
"""

from __future__ import annotations

import math
from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class CPMM:
    """Constant product `x*y = k` with a proportional fee (spec §2.1).

        f(d)  = x0 * dt / (y0 + dt),   dt = (1 - phi) d
        a     = (1 - phi) x0 / y0
        B     = 2 (1 - phi)^2 x0 / y0^2
    """

    x_out: float  # output reserve
    y_in: float  # input reserve
    fee: float = 0.0

    @property
    def retention(self) -> float:
        return 1.0 - self.fee

    def f(self, delta: float) -> float:
        dt = self.retention * delta
        return self.x_out * dt / (self.y_in + dt)

    @property
    def a(self) -> float:
        return self.retention * self.x_out / self.y_in

    @property
    def B(self) -> float:
        return 2 * self.retention**2 * self.x_out / self.y_in**2

    def reverse(self) -> CPMM:
        return CPMM(x_out=self.y_in, y_in=self.x_out, fee=self.fee)

    def theta(self, delta: float) -> float:
        return self.retention * delta / self.y_in


@dataclass(frozen=True, slots=True)
class ConvexArc:
    """An arc with genuinely increasing returns on `[0, cap]`.

        f(d) = a0 d (1 + c d)      f'' = 2 a0 c > 0

    Stands in for a fee that falls with size faster than price impact bites.
    Concavity fails, so the quadratic model is inadmissible and the arc must be
    clamped.
    """

    a0: float
    c: float
    cap: float

    def f(self, delta: float) -> float:
        d = min(delta, self.cap)
        return self.a0 * d * (1 + self.c * d)

    @property
    def chord_slope(self) -> float:
        return self.f(self.cap) / self.cap

    @property
    def tangent_slope(self) -> float:
        return self.a0


@dataclass(frozen=True, slots=True)
class DynamicFeeCPMM:
    """CPMM whose retention moves with trade size.

    `slope > 0` is the *rebalancing* direction: a bigger trade pushes the pool
    toward balance, raising the retention, so the effective fee falls with size
    and the arc gains a convex contribution.  `slope < 0` is the imbalancing
    direction, where the fee rises with size and the arc is better behaved than a
    plain CPMM.  That asymmetry is the point: on a real dynamic-fee pool exactly
    one direction carries CONVEX_FLAG, and flagging the *pool* would throw away
    half the routing graph.
    """

    x_out: float
    y_in: float
    base_fee: float
    slope: float  # d(retention) / d(theta)

    def retention(self, delta: float) -> float:
        theta = delta / self.y_in
        return min(1.0, (1.0 - self.base_fee) + self.slope * theta)

    def f(self, delta: float) -> float:
        dt = self.retention(delta) * delta
        return self.x_out * dt / (self.y_in + dt)


def ladder(pool, deltas) -> tuple[list[float], list[float]]:
    """Quote a pool at each delta, keeping only the successful (positive) ones."""
    xs, ys = [], []
    for d in deltas:
        value = pool.f(d)
        if value > 0:
            xs.append(float(d))
            ys.append(float(value))
    return xs, ys


def geometric_grid(reserve: float, fractions=(1e-6, 1e-4, 1e-3, 1e-2, 3e-2, 1e-1)):
    return [reserve * f for f in fractions]


def cpmm_error_ratio(theta: float, theta_bar: float | None) -> float:
    """Spec §2.4's exact error ratios, for checking the accuracy budget.

    tangent: 1 - theta^2       (under-promises)
    secant:  (1+theta)(1+theta_bar-theta)/(1+theta_bar)   (overshoots mid-range)
    """
    if theta_bar is None:
        return 1 - theta**2
    return (1 + theta) * (1 + theta_bar - theta) / (1 + theta_bar)


def assert_close(got: float, want: float, rel: float = 1e-9) -> None:
    assert math.isclose(got, want, rel_tol=rel), f"{got!r} != {want!r}"
