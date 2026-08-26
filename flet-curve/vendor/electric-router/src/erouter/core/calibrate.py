"""Probe-ladder calibration and the non-concavity detector (spec §2.3, §2.6).

Four evaluations of the true `f` -- the free origin plus three quotes --
determine `(a, B)` *and* say whether the quadratic model is admissible at all:

    a = f(delta_eps) / delta_eps
    B = 2 (a d_bar - f(d_bar)) / d_bar^2          secant fit  (M2)

The secant fit matches the true curve exactly at 0 and at `d_bar`.  Use it, not
the tangent `|f''(0)|`: for CPMM the tangent is off by `-theta^2` (100 bp at
theta = 10%) while the secant overshoots by only `theta_bar^2/4` (2.5 bp).  The
tangent under-promises, which is the safe direction, but the secant is 4x
tighter and the quote is re-verified on-chain anyway.

**The ladder is a detector, not a model.**  The divided differences are
diagnostics; they are never substituted into the solve.  Extra probes do
correctly *see* dynamic-fee non-concavity, but no Taylor order is
simultaneously faithful to increasing returns and admissible in a convex
program: if the fit reports `f'' > 0` anywhere then `G = nu a / B < 0`, the
Laplacian stops being PSD, and the certificate is void.  So the element law
stays quadratic and `B` is clamped at zero, never negative.
"""

from __future__ import annotations

import math
import os
from dataclasses import dataclass

import numpy as np

from . import accel as _accel
from .types import FlagReason

DRIFT_TOL = 0.25
#: The compiled fit is opt-in on the same switch as the compiled solve, so
#: a session runs both ports or neither and a comparison means something.
_ACCEL_ON = os.environ.get("EROUTER_ACCEL", "") == "1"
# Two probes an order of magnitude apart returning the *same* output is not a
# curve, it is a wall: the venue has handed over everything it has.  Measured on
# a LLAMMA WETH market, `get_dy` returned the same 11.472806 crvUSD across a
# thousandfold range of inputs.  Fitting a rate through saturated points reads
# the marginal price sixfold low, and in §4's log-price fit that one arc drags
# the whole frame.
SATURATION_TOL = 1e-9
# How far apart two ladder nodes must be to count as two probes at all.
#
# The wall test asks whether a bigger probe bought more, which two probes at the
# *same* size cannot answer: they return the same quote, and "bought nothing
# more" then clamps a perfectly healthy arc.  `merge` already drops duplicates,
# but it keys on exact integer wei while the refine pass computes its sizes in
# floats, so a ladder node landing on a grid node survives as a near-duplicate --
# measured on tac, where the second copy read as saturation, capped the arc at a
# tenth of the trade, and reported "src not connected to dst" on a chain whose
# pool quotes the swap happily.
#
# A millionth is far below any deliberate spacing (the grid is decades apart, the
# ladder doubles) and far above the wei-level noise this exists to absorb.
DUPLICATE_TOL = 1e-6
# A local `B` that jumps by more than this between grid nodes is a liquidity
# cliff -- for stableswap, the edge of the peg (§2.5).
PEG_JUMP = 4.0


class CalibrationError(ValueError):
    pass


@dataclass(frozen=True, slots=True)
class Calibration:
    """The result of one arc's ladder.

    `B >= 0` and `clamped => isfinite(cap)` are enforced here, in the *only*
    place that produces a `B`.  That is what makes a negative conductance
    structurally impossible rather than something the solver has to guard
    against: `G = nu a / B` can then only be positive or (clamped) infinite,
    and the infinite case is bounded in G-space by the §9.7 ceiling.
    """

    a: float
    B: float
    cap: float = math.inf
    clamped: bool = False
    convex_flag: bool = False
    flag_reason: FlagReason = FlagReason.NONE
    drift: float = 0.0
    eta: float = math.nan
    split_hint: bool = False
    calib_delta: float = 0.0
    tangent_delta: float = 0.0
    note: str = ""

    def __post_init__(self) -> None:
        if not (self.a > 0):
            raise CalibrationError(f"a must be positive, got {self.a!r}")
        if self.B < 0:
            raise CalibrationError(
                f"B must be clamped to 0, got {self.B!r}; a negative curvature "
                "makes the Laplacian indefinite (§11.2)"
            )
        if self.clamped and not math.isfinite(self.cap):
            raise CalibrationError(
                "a clamped arc needs a finite cap: it has no self-limiting term, "
                "so a negative-eps cycle would give unbounded flow (§2.3 rule 2)"
            )

    @property
    def domain(self) -> float:
        """`d_bar = a/B`, where the quadratic model turns decreasing (M1)."""
        return math.inf if self.B <= 0 else self.a / self.B


def second_divided_differences(x: np.ndarray, y: np.ndarray) -> np.ndarray:
    """`f[x_k, x_k+1, x_k+2] = f''(xi)/2` for each consecutive triple.

    Mean-value form, so the `xi` are exact rather than asymptotic.  Computing
    these on *every* triple of a geometric grid is a strictly stronger detector
    than one 4-node ladder.
    """
    first = np.diff(y) / np.diff(x)
    return np.diff(first) / (x[2:] - x[:-2])


def calibrate(
    deltas,
    quotes,
    *,
    delta_bar: float | None = None,
    structural_flag: bool = False,
    drift_tol: float = DRIFT_TOL,
    cap: float | None = None,
    f_at_cap: float | None = None,
    quantum: float = 0.0,
) -> Calibration:
    """Fit one arc from its probe ladder.

    `deltas`/`quotes` are the *successful* probes in increasing size.  The
    origin `f(0) = 0` is free and prepended here.  `a` comes from the smallest
    node, which is why the grid escalates: 6% of mainnet arcs fail at
    `1e-6 * reserve` and a couple return zero, and a zero `a` would poison
    `log a` in the reference-price fit.
    """
    # The compiled fit, when it is installed.  Six-element arrays are the whole
    # reason: `np.diff`, `np.interp` and `np.concatenate` over six floats cost
    # 50 us a call and this runs 736 times a quote, so the dispatch is the bill
    # rather than the arithmetic.  `test_calibrate_differential.py` differs them.
    if _ACCEL_ON and _accel.available():
        got = _accel.calibrate_ladder(
            deltas, quotes, delta_bar=delta_bar,
            structural_flag=structural_flag, drift_tol=drift_tol, cap=cap,
            f_at_cap=f_at_cap, quantum=quantum)
        if got is not None:
            return got

    x = np.asarray(deltas, dtype=float)
    y = np.asarray(quotes, dtype=float)
    if x.ndim != 1 or x.shape != y.shape:
        raise CalibrationError("deltas and quotes must be 1-D and the same length")
    if x.size < 2:
        raise CalibrationError(f"need at least 2 probes, got {x.size}")
    if not np.all(np.diff(x) > 0):
        raise CalibrationError("deltas must be strictly increasing")
    if not np.all(y > 0):
        raise CalibrationError("all quotes must be positive; drop failed probes first")

    # Two nodes at the same size are one probe, and the wall test below cannot
    # read them as anything but saturation.  Collapse them first; see
    # `DUPLICATE_TOL`.
    if x.size > 1:
        distinct = np.ones(x.size, bool)
        distinct[1:] = np.diff(x) > x[:-1] * DUPLICATE_TOL
        if not distinct.all():
            x, y = x[distinct], y[distinct]
            if x.size < 2:
                raise CalibrationError(
                    "need at least 2 probes at distinct sizes, got 1 after "
                    "collapsing duplicates"
                )

    tangent_delta = float(x[0])
    a = float(y[0] / x[0])

    # --- capacity wall (§2.3 rule 2) -------------------------------------
    #
    # Truncate to the strictly-increasing prefix, and treat the last size that
    # still bought something more as a hard cap.  This is the clamped-arc shape
    # the spec provides for: no self-limiting term beyond the cap, so the cap
    # must be finite -- which it is, by construction here.
    saturated_at: float | None = None
    for k in range(1, x.size):
        if y[k] <= y[k - 1] * (1.0 + SATURATION_TOL):
            saturated_at = float(x[k - 1])
            x, y = x[:k], y[:k]
            break
    if saturated_at is not None and x.size == 1:
        # Everything above the smallest probe is flat: the arc is a fixed
        # payout, which the quadratic model cannot express at all beyond `a`.
        return Calibration(
            a=a, B=0.0, cap=saturated_at, clamped=True, convex_flag=True,
            flag_reason=FlagReason.CLAMPED, calib_delta=saturated_at,
            tangent_delta=tangent_delta, note="SATURATED",
        )

    if saturated_at is not None:
        cap = saturated_at if cap is None else min(cap, saturated_at)
    d_bar = float(delta_bar if delta_bar is not None else x[-1])
    f_bar = float(np.interp(d_bar, x, y))
    B = 2.0 * (a * d_bar - f_bar) / d_bar**2

    # --- what the output token's own resolution can fake ------------------
    #
    # `quotes` are integers of the output token, so every one is rounded down by
    # up to one unit.  For an 18-decimal token that is nothing; for GUSD's *two*
    # it is 0.01, and the ladder's small node carries it into `a`:
    #
    #     a  = y0 / x0                    error  quantum / x0
    #     B  = 2 (a d - f(d)) / d^2       error  2 (quantum/x0) / d + 2 quantum / d^2
    #
    # Measured on 3Crv -> GUSD, where the fitted curvature is -2.9e-8 against a
    # noise floor of 4.8e-8: the entire "increasing returns" the pool appeared to
    # show was the rounding, and clamping on it made a $10,000 trade unroutable.
    #
    # Below the floor the sign of the curvature is simply unknown.  Taking the
    # floor itself as `B` is the flattest reading the data supports, which is the
    # direction §2.3 clamps in -- optimistic, bounded, and finite, so the arc
    # keeps a conductance instead of needing a cap.
    noise = 0.0
    if quantum > 0:
        noise = 2.0 * (quantum / float(x[0])) / d_bar + 2.0 * quantum / d_bar**2
    quantised = B < 0.0 and -B <= noise
    if quantised:
        B = noise

    # Two node sets, for two different jobs.  Flag detection uses *every* probe,
    # so a convex patch anywhere on the sampled range is caught -- strictly
    # stronger than one 4-node ladder.
    xs = np.concatenate(([0.0], x))
    ys = np.concatenate(([0.0], y))
    D = second_divided_differences(xs, ys)
    numeric_flag = bool(np.any(D > 0) or (D.size > 1 and len(set(np.sign(D))) > 1))

    # DRIFT and eta use the local window `{0, d/4, d/2, d}` of §2.3: the origin
    # (exact, not a probe) plus the top three nodes, with the tiny tangent probe
    # deliberately excluded.  Divided differences estimate a derivative *at a
    # point*, so spreading the nodes over decades measures the spread rather than
    # the curve.  Four nodes are needed, so a two-point coarse pass reports
    # neither -- by design: they are diagnostics for arcs that carry flow.
    drift = 0.0
    eta = math.nan
    if x.size >= 3:
        xs_local = np.concatenate(([0.0], x[-3:]))
        ys_local = np.concatenate(([0.0], y[-3:]))
        D_local = second_divided_differences(xs_local, ys_local)
        if D_local[0] != 0:
            drift = float(D_local[1] / D_local[0] - 1.0)
        if D_local[1] != 0:
            D3 = float((D_local[1] - D_local[0]) / (xs_local[3] - xs_local[0]))
            eta = 3.0 * a * D3 / (2.0 * D_local[1] ** 2)

    note = "SATURATED" if saturated_at is not None else ""
    if quantised:
        note = "QUANTISED"
    # A wall is a cap even when the fitted curvature is healthy: without it the
    # solver sizes the arc from `B` alone and posts flow the venue cannot fill.
    clamped = B <= 0.0 or saturated_at is not None
    flag_reason = FlagReason.NONE
    if numeric_flag and structural_flag:
        flag_reason = FlagReason.BOTH
    elif numeric_flag:
        flag_reason = FlagReason.DIVIDED_DIFF
    elif structural_flag:
        flag_reason = FlagReason.STRUCTURAL

    if clamped:
        # §2.3 zero-curvature clamp.  B = 0 is the *admissible limit* -- a
        # linear arc, no price impact, an ideal diode with no series
        # resistance -- and it is exactly the local concave envelope.
        if cap is None or not math.isfinite(cap):
            # The convex region always terminates, and the default cap is the
            # last ladder node we have data for.
            cap = float(x[-1])
            f_at_cap = float(y[-1])
            note = "CAP_FROM_LADDER"
        if f_at_cap is None:
            f_at_cap = float(np.interp(cap, x, y))
        if not (f_at_cap > 0):
            raise CalibrationError("clamped arc needs a positive f(cap) for the chord")
        # CHORD, not tangent.  Clamping B while keeping a = f'(0) leaves the
        # tangent, which on a convex piece lies *below* the curve -- an
        # under-estimate that makes the solver silently skip the arc.  The chord
        # is exact at both endpoints and above the curve in between: a valid
        # concave majorant, hence an upper bound, hence it cannot prune the true
        # optimum.
        a = float(f_at_cap / cap)
        B = 0.0
        flag_reason = FlagReason.CLAMPED if flag_reason is FlagReason.NONE else FlagReason.BOTH

    return Calibration(
        a=a,
        B=max(B, 0.0),
        cap=float(cap) if cap is not None else math.inf,
        clamped=clamped,
        convex_flag=bool(numeric_flag or structural_flag or clamped),
        flag_reason=flag_reason,
        drift=drift,
        eta=eta,
        split_hint=bool(abs(drift) > drift_tol),
        calib_delta=d_bar,
        tangent_delta=tangent_delta,
        note=note,
    )


def peg_boundary(deltas, quotes, *, jump: float = PEG_JUMP) -> float | None:
    """Where local curvature jumps -- the edge of a stableswap's flat region.

    §2.5 calls a single fit across this boundary "the most dangerous single
    mis-calibration in the system": inside the peg the pool looks bottomless, and
    any trade that leaves it is wildly over-promised.  The geometric grid turns
    detecting it into a comparison of second divided differences rather than a
    hope that `d_bar` landed inside the flat region.

    Returns the delta at which to split the arc, or None.
    """
    x = np.concatenate(([0.0], np.asarray(deltas, float)))
    y = np.concatenate(([0.0], np.asarray(quotes, float)))
    if x.size < 4:
        return None
    D = np.abs(second_divided_differences(x, y))
    for k in range(1, D.size):
        if D[k - 1] > 0 and D[k] > jump * D[k - 1]:
            return float(x[k + 1])
    return None


def asym(a_f: float, a_r: float, B_f: float, B_r: float) -> float:
    """`log(B_r/B_f) + 1.5 log(a_f/a_r)` -- zero for any smooth symmetric-fee CFMM.

    Needs no reference prices, and holds regardless of curve shape, reserve
    ratio or fee level.  Nonzero means *genuine* directional asymmetry (a v3
    tick distribution, a stableswap peg side, a dynamic fee, a transfer tax,
    or integer rounding), which means `B` must be calibrated per direction and
    never derived from the other one by (M8).

    Use tangent values: secant fits anchor at different points on different
    curves, so their conductances legitimately differ.
    """
    if min(a_f, a_r, B_f, B_r) <= 0:
        return math.nan
    return math.log(B_r / B_f) + 1.5 * math.log(a_f / a_r)


def model_output(calibration: Calibration, delta: float) -> float:
    """`f_hat(delta) = a delta - B delta^2 / 2`, clipped to the model domain."""
    d = min(delta, calibration.domain)
    return calibration.a * d - 0.5 * calibration.B * d * d
