"""`erouter_solve`, served by the wasm module.

Every signature here is the PyO3 extension's, because `core/accel.py` is not
allowed to know which one it got -- including the details that look
incidental: `solve` returns its vectors as `bytes` for `np.frombuffer`, and
`calibrate` returns a twelve-field tuple in `Calibration`'s declaration order.

The crossings are typed arrays.  `to_js` on a contiguous numpy buffer picks
the matching TypedArray by format, which is what the module's `&[f64]` and
`&[i32]` parameters want; a Python list would work and copy element by
element.  Everything that comes back is freed here rather than left to the
JS GC, which does not know how much wasm memory a handle is holding.
"""

from __future__ import annotations

import contextlib

import numpy as np

_mod = None


def bind(module) -> None:
    global _mod
    _mod = module


def version() -> str:
    return str(_mod.version())


__version__ = "wasm"
__doc_module__ = "The router's active-set QP, in Rust, in a browser."


def _typed(values, dtype):
    """A sequence as the TypedArray the module's slice parameter wants.

    Through a `memoryview`, which is the conversion Pyodide documents: it
    picks the array type from the buffer's format, so `float64` arrives as
    `Float64Array` and `int32` as `Int32Array` with no per-element work.  A
    plain Python list would also be accepted by wasm-bindgen and would copy
    one element at a time.
    """
    from pyodide.ffi import to_js

    return to_js(memoryview(np.ascontiguousarray(values, dtype=dtype)))


def _f64(values):
    return _typed(values, np.float64)


def _i32(values):
    return _typed(values, np.int32)


def _u32(values):
    return _typed(values, np.uint32)


def _u8(values):
    return _typed(values, np.uint8)


def _bytes(buffer) -> bytes:
    """A `Float64Array` or `Uint8Array` as Python bytes.

    Not destroyed afterwards, and that is deliberate rather than an omission:
    a Pyodide `JsBuffer` has `to_bytes` and no `destroy` -- `AttributeError:
    destroy` was what the browser answered for every quote, while the same
    code answered fine in CPython, because there is no JsBuffer there to
    differ.  Each of these is a fresh TypedArray the getter just made, so
    letting the JS collector have it is also the right thing.
    """
    return buffer.to_bytes()


def _nan(value) -> float:
    """`None` as NaN, which is how an `f64` parameter carries an absent value."""
    return float("nan") if value is None else float(value)


def _pack(result) -> dict:
    """A `SolveResult` as the dict PyO3 returns, then freed."""
    try:
        return {
            "psi": _bytes(result.psi),
            "u": _bytes(result.u),
            "active": _bytes(result.active),
            "upper": _bytes(result.upper),
            "psi_upper": _bytes(result.psiUpper),
            "rho": _bytes(result.rho),
            "pivots": int(result.pivots),
            "chol_failures": int(result.cholFailures),
            "keep_changes": int(result.keepChanges),
            "refits": int(result.refits),
            "timings": [int(v) for v in result.timings.to_py()],
            "feasible": bool(result.feasible),
            "reason": str(result.reason),
        }
    finally:
        result.free()


class Problem:
    """The graph, resident on the wasm side across a quote's many solves."""

    def __init__(self, tau, sig, g, eps, cap, n_nodes):
        self._inner = _mod.Problem.new(
            _i32(tau), _i32(sig), _f64(g), _f64(eps), _f64(cap), int(n_nodes)
        )

    @property
    def m(self) -> int:
        return int(self._inner.m)

    def shortest_path(self, src, dst, banned_arcs=None, banned_nodes=None,
                      weights=None, max_hops=8):
        got = self._inner.shortestPath(
            int(src), int(dst),
            None if not banned_arcs else _u32(banned_arcs),
            None if not banned_nodes else _u32(banned_nodes),
            None if weights is None else _f64(weights),
            int(max_hops),
        )
        try:
            return {
                "arcs": [int(v) for v in got.arcs.to_py()],
                "length": float(got.length),
                "found": bool(got.found),
                "negative_cycle": [int(v) for v in got.negativeCycle.to_py()],
            }
        finally:
            got.free()

    def solve(self, src, dst, psi_total, a0=None, forbidden=None, pinned=None,
              tol=None, maxit=600, min_flow=0.0, gas_cost=0.0, partial_ok=False,
              rank1=None):
        # An empty array says "absent": a nullable typed array would be a
        # second shape for the module to check on the per-keystroke path.
        pins = list(pinned or [])
        return _pack(self._inner.solve(
            int(src), int(dst), float(psi_total),
            _u8([] if a0 is None else np.asarray(a0, bool)),
            _u8([] if forbidden is None else np.asarray(forbidden, bool)),
            _u32([p for p, _ in pins]),
            _f64([v for _, v in pins]),
            float(TOL if tol is None else tol),
            int(maxit), float(min_flow), float(gas_cost), bool(partial_ok),
            True if rank1 is None else bool(rank1),
        ))

    def close(self) -> None:
        inner, self._inner = self._inner, None
        if inner is not None:
            inner.free()

    def __del__(self):  # pragma: no cover - collection order is the GC's
        with contextlib.suppress(Exception):
            self.close()


#: `core.solve.TOL`, repeated rather than imported: this module stands in for
#: an extension, and an extension does not import from `erouter.core`.
TOL = 1e-10


def solve(tau, sig, g, eps, cap, n_nodes, src, dst, psi_total, a0=None,
          forbidden=None, pinned=None, tol=None, maxit=600, min_flow=0.0,
          gas_cost=0.0, partial_ok=False, rank1=None):
    """One solve on a graph that is not resident.  `Problem` is the hot path."""
    problem = Problem(tau, sig, g, eps, cap, n_nodes)
    try:
        return problem.solve(
            src, dst, psi_total, a0=a0, forbidden=forbidden, pinned=pinned,
            tol=tol, maxit=maxit, min_flow=min_flow, gas_cost=gas_cost,
            partial_ok=partial_ok, rank1=rank1,
        )
    finally:
        problem.close()


def calibrate(deltas, quotes, delta_bar=None, structural_flag=False,
              drift_tol=0.05, cap=None, f_at_cap=None, quantum=0.0):
    """The twelve `Calibration` fields, in declaration order.

    Raises `ValueError` as PyO3 does, so `accel.calibrate_ladder` can turn it
    into the `CalibrationError` its callers catch.
    """
    from pyodide.ffi import JsException

    try:
        got = _mod.calibrate(
            _f64(deltas), _f64(quotes), _nan(delta_bar), bool(structural_flag),
            float(drift_tol), _nan(cap), _nan(f_at_cap), float(quantum),
        )
    except JsException as exc:
        raise ValueError(str(exc)) from None
    try:
        return (
            float(got.a), float(got.b), float(got.cap), bool(got.clamped),
            bool(got.convexFlag), str(got.flag), float(got.drift),
            float(got.eta), bool(got.splitHint), float(got.calibDelta),
            float(got.tangentDelta), str(got.note),
        )
    finally:
        got.free()


def cancel_cycles(tau, sig, psi, tol=1e-12, n_nodes=None):
    got = _mod.cancelCycles(
        _i32(tau), _i32(sig), _f64(psi), float(tol),
        0 if n_nodes is None else int(n_nodes),
    )
    try:
        flow = np.frombuffer(_bytes(got.flow), dtype=np.float64)
        return flow.tolist(), int(got.removed)
    finally:
        got.free()


def find_cycle(tau, sig, n_nodes=None):
    arcs = _mod.findCycle(_i32(tau), _i32(sig),
                          0 if n_nodes is None else int(n_nodes))
    got = [int(v) for v in arcs.to_py()]
    # An empty array is how the module spells `None`; a cycle is never empty.
    return got or None


def split_ascend(curves, src_of, dst_of, static_share, heads, tails, slots,
                 dst_slot, amount_in, start, free, min_weight, iters, sweeps,
                 window, sweep_tol):
    """The split search.  Everything ragged is flattened with offsets.

    A JSON payload would be one line instead of thirty, and this runs on the
    per-keystroke path: the curves alone are ~10,000 floats, which is a
    200 kB parse per quote for data that a typed array carries as bytes.
    """
    curve_x, curve_u, curve_slope = [], [], []
    curve_off, slope_off = [0], [0]
    rate0, tail_values = [], []
    for x, u, slope, r0, tail in curves:
        curve_x.extend(x)
        curve_u.extend(u)
        curve_slope.extend(slope)
        curve_off.append(len(curve_x))
        # Its own offsets: `slope` is `diff(u) / diff(x)`, so it is one shorter
        # than the points it was fitted between.
        slope_off.append(len(curve_slope))
        rate0.append(r0)
        tail_values.append(tail)

    heads_flat, heads_off = [], [0]
    for row in heads:
        heads_flat.extend(row)
        heads_off.append(len(heads_flat))

    start_flat, start_off = [], [0]
    for row in start:
        start_flat.extend(row)
        start_off.append(len(start_flat))

    got = _mod.splitAscend(
        _f64(curve_x), _f64(curve_u), _f64(curve_slope),
        _u32(curve_off), _u32(slope_off), _f64(rate0), _f64(tail_values),
        _u32(src_of), _u32(dst_of),
        # NaN is "not fixed", the same spelling `calibrate` uses for absent.
        _f64([_nan(v) for v in static_share]),
        _u32(heads_flat), _u32(heads_off), _u32(tails),
        int(slots), int(dst_slot), float(amount_in),
        _f64(start_flat), _u32(start_off),
        _u32([s for s, _ in free]), _u32([i for _, i in free]),
        float(min_weight), int(iters), int(sweeps), float(window),
        float(sweep_tol),
    )
    try:
        weights = np.frombuffer(_bytes(got.weights), dtype=np.float64)
        offsets = np.frombuffer(_bytes(got.offsets), dtype=np.uint32)
        rows = [weights[offsets[k]:offsets[k + 1]].tolist()
                for k in range(len(offsets) - 1)]
        return rows, float(got.best), int(got.evaluations)
    finally:
        got.free()
