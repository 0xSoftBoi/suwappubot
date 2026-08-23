"""The compiled fit against the reference, on the shapes a ladder really takes.

`calibrate` is the only function in the codebase that produces a `B`, so the
port has to agree with it everywhere -- not merely on the well-behaved fits, but
on the walls, the duplicates, the quantised curvature and the refusals, which
is where a quote actually differs.
"""

from __future__ import annotations

import math

import numpy as np
import pytest

from erouter.core import accel
from erouter.core.calibrate import DRIFT_TOL, Calibration, CalibrationError, calibrate

pytestmark = pytest.mark.skipif(
    not accel.available(), reason="the Rust fit is not installed")


def rust(deltas, quotes, **kw):
    return accel.calibrate_ladder(
        deltas, quotes,
        delta_bar=kw.get("delta_bar"), structural_flag=kw.get("structural_flag", False),
        drift_tol=kw.get("drift_tol", DRIFT_TOL), cap=kw.get("cap"),
        f_at_cap=kw.get("f_at_cap"), quantum=kw.get("quantum", 0.0))


def same(a: Calibration, b: Calibration) -> None:
    for field in ("a", "B", "cap", "calib_delta", "tangent_delta", "drift"):
        x, y = getattr(a, field), getattr(b, field)
        if math.isinf(x) or math.isinf(y):
            assert x == y, field
        else:
            assert x == pytest.approx(y, rel=1e-12, abs=1e-18), field
    if math.isnan(a.eta) or math.isnan(b.eta):
        assert math.isnan(a.eta) and math.isnan(b.eta), "eta"
    else:
        assert a.eta == pytest.approx(b.eta, rel=1e-12), "eta"
    for field in ("clamped", "convex_flag", "split_hint", "flag_reason", "note"):
        assert getattr(a, field) == getattr(b, field), field


LADDERS = {
    "cpmm": ([1.0, 1e2, 1e3, 1e4], None),
    "near linear": ([1.0, 10.0, 100.0, 1000.0], None),
    "wall": ([1.0, 10.0, 100.0, 1000.0], [1.0, 10.0, 11.472806, 11.472806]),
    "wall at once": ([1.0, 10.0], [11.472806, 11.472806]),
    "two probes": ([1.0, 1e4], None),
    "duplicate": ([1.0, 1.0 + 1e-12, 100.0], [1.0, 1.0, 99.0]),
    "increasing returns": ([1.0, 10.0, 100.0], [1.0, 10.5, 108.0]),
}


def ladder(name):
    sizes, quotes = LADDERS[name]
    x = np.asarray(sizes, float)
    # `None` stands for a CPMM with x0 = y0 = 1e6.
    y = 1e6 * x / (1e6 + x) if quotes is None else np.asarray(quotes, float)
    return x, y


@pytest.mark.parametrize("name", sorted(LADDERS))
@pytest.mark.parametrize("structural", [False, True])
def test_the_port_reproduces_the_reference(name, structural):
    x, y = ladder(name)
    try:
        want = calibrate(x, y, structural_flag=structural)
    except CalibrationError as exc:
        with pytest.raises(CalibrationError, match=str(exc)[:20]):
            rust(x, y, structural_flag=structural)
        return
    same(want, rust(x, y, structural_flag=structural))


@pytest.mark.parametrize("quantum", [0.0, 1e-6, 0.01, 1.0])
def test_the_quantisation_floor_agrees(quantum):
    """The floor decides whether a healthy pool gets capped, so it must match."""
    x = np.array([1.0, 10.0, 100.0, 1000.0])
    y = np.array([1.0, 10.0, 100.000001, 999.99])
    want = calibrate(x, y, quantum=quantum)
    same(want, rust(x, y, quantum=quantum))


@pytest.mark.parametrize("cap", [None, 500.0, math.inf])
def test_a_supplied_cap_agrees(cap):
    x, y = ladder("wall")
    want = calibrate(x, y, cap=cap)
    same(want, rust(x, y, cap=cap))


@pytest.mark.parametrize("seed", range(24))
def test_random_ladders_agree(seed):
    rng = np.random.default_rng(seed)
    n = int(rng.integers(2, 7))
    x = np.sort(rng.random(n) * 10 ** rng.integers(0, 5) + 1e-3)
    if np.any(np.diff(x) <= 0):
        pytest.skip("degenerate draw")
    depth = 10 ** rng.integers(3, 7)
    y = depth * x / (depth + x) * (1.0 - rng.random(n) * 1e-3)
    y = np.maximum.accumulate(y) if rng.random() < 0.5 else y
    kw = {"structural_flag": bool(rng.random() < 0.3),
              "quantum": float(rng.choice([0.0, 1e-9, 1e-3]))}
    try:
        want = calibrate(x, y, **kw)
    except CalibrationError:
        with pytest.raises(CalibrationError):
            rust(x, y, **kw)
        return
    same(want, rust(x, y, **kw))
