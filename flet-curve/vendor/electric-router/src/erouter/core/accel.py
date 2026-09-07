"""The Rust solver, when it is there.

`erouter.core` has to stay importable with nothing but numpy -- that is what
`tests/test_purity.py` guards, and it is the reason the Flet frontend can load
this at all.  So the accelerator is *never* a requirement: this module tries the
import, and every caller has a pure-Python path that answers when it is absent.

The boundary is one call per solve rather than per pivot.  A quote runs ~45
solves and ~2,250 pivots; crossing per pivot would pay the FFI cost fifty times
more often and, worse, would leave the pivot loop in Python, which is the part
that actually costs.

Arrays cross as plain lists rather than numpy buffers.  That keeps the
extension clear of the numpy C API, which is the fiddliest part of shipping a
native module into Pyodide -- the same wheel then works in CPython, in the
browser, and in a Web Worker.
"""

from __future__ import annotations

import contextlib

import numpy as np

try:  # pragma: no cover - exercised by whichever half is installed
    import erouter_solve as _rust
except ImportError:  # pragma: no cover
    _rust = None

def available() -> bool:
    """Whether the compiled solver can be used at all."""
    return _rust is not None

def version() -> str:
    return getattr(_rust, "__version__", "unknown") if _rust else "absent"

def problem_for(g):
    """The Rust-side graph for `g`, built once and kept on it.

    A quote solves 45-106 times over the same arcs; only the warm start, the
    forbidden mask and the pins differ.  Handing `tau`, `sig`, `G`, `eps` and
    `cap` across the boundary every time cost about what the Rust arithmetic
    saved.

    Cached on the `ArcArrays` itself, keyed by `id` of the arrays it was built
    from, so a graph that is rebuilt gets a new problem rather than a stale one.
    It carries an `accel` field for this: `slots=True` leaves nowhere else.
    """
    if _rust is None:
        return None
    key = (id(g.tau), id(g.sig), id(g.G), id(g.eps), id(g.cap))
    got = g.accel
    if got is not None and got[0] == key:
        return got[1]
    caps = np.asarray(g.cap, float)
    # `inf` crosses as a float and is what a capless arc needs; anything else
    # non-finite would be a bug upstream, and mapping it to `inf` keeps the
    # arc admissible rather than poisoning every comparison it appears in.
    cap = np.where(np.isfinite(caps), caps, np.inf).tolist()
    problem = _rust.Problem(
        np.asarray(g.tau, np.int64).tolist(),
        np.asarray(g.sig, np.int64).tolist(),
        np.asarray(g.G, float).tolist(),
        np.asarray(g.eps, float).tolist(),
        cap,
        int(g.n_nodes),
    )
    # A graph that will not hold it is not an error; the cache is a bonus.
    with contextlib.suppress(AttributeError, TypeError):
        g.accel = (key, problem)
    return problem


def _seed_mask(a0, m: int) -> list[bool]:
    """`A0` as a length-`m` boolean mask, however it was spelled.

    The Python solver writes `A[np.asarray(A0)] = True`, which accepts either a
    mask or a list of indices -- and `Solution.active` is a list of indices, which
    is what the pipeline warm-starts from.  Handing that to `np.asarray(a0, bool)`
    turns `[3, 17, 42]` into three `True`s, so the accelerated path silently
    started from a different basis.
    """
    arr = np.asarray(a0)
    if arr.dtype == np.bool_ and arr.shape == (m,):
        return arr.tolist()
    mask = np.zeros(m, bool)
    mask[arr] = True
    return mask.tolist()


def solve_arrays(
    g,
    src: int,
    dst: int,
    psi_total: float,
    *,
    a0=None,
    forbidden=None,
    pinned=None,
    tol: float,
    maxit: int,
    min_flow: float,
    gas_cost: float,
    partial_ok: bool,
    rank1: bool = True,
) -> dict | None:
    """Run the Rust solve, or return None if it is not installed.

    `inf` survives the crossing as a float, which is what a capless arc needs;
    NaN would not, and does not occur -- `calibrate` is the only source of
    `cap` and it is either finite or `inf` by construction (§2.3).
    """
    problem = problem_for(g)
    if problem is None:
        return None
    got = problem.solve(
        src=int(src),
        dst=int(dst),
        psi_total=float(psi_total),
        a0=None if a0 is None else _seed_mask(a0, int(g.m)),
        forbidden=None if forbidden is None else
        np.asarray(forbidden, bool).tolist(),
        pinned=None if not pinned else [(int(k), float(v)) for k, v in pinned.items()],
        tol=float(tol),
        maxit=int(maxit),
        min_flow=float(min_flow),
        gas_cost=float(gas_cost),
        partial_ok=bool(partial_ok),
        rank1=bool(rank1),
    )
    # The six vectors come back as raw buffers, not lists.  Building a list of
    # 778 floats is 778 `PyFloat` allocations for numpy to walk afterwards --
    # 14 us against 0.95 us for `frombuffer`, six times a solve.  Decoded here
    # rather than at the call sites so the returned mapping still holds arrays.
    #
    # The float ones are copied because callers write into `psi`; the masks
    # convert, which copies anyway.
    for key in ("psi", "u", "psi_upper", "rho"):
        got[key] = np.frombuffer(got[key], dtype=np.float64).copy()
    for key in ("active", "upper"):
        got[key] = np.frombuffer(got[key], dtype=np.uint8).astype(bool)
    return got


def calibrate_ladder(deltas, quotes, *, delta_bar, structural_flag, drift_tol,
                     cap, f_at_cap, quantum):
    """One arc's ladder through the compiled fit, or `None` if it is absent.

    Returns a `Calibration`, built here rather than in Rust so the dataclass
    keeps its own postconditions -- `B >= 0` and `clamped => cap finite` are
    checked in the one place that produces a `B`, whichever language did the
    arithmetic.
    """
    if _rust is None:
        return None
    from .calibrate import Calibration, CalibrationError
    from .types import FlagReason

    try:
        got = _rust.calibrate(
            [float(v) for v in deltas], [float(v) for v in quotes],
            None if delta_bar is None else float(delta_bar),
            bool(structural_flag), float(drift_tol),
            None if cap is None else float(cap),
            None if f_at_cap is None else float(f_at_cap),
            float(quantum),
        )
    except ValueError as exc:
        # The reference raises `CalibrationError`, and callers catch exactly
        # that.  PyO3 hands back a plain `ValueError`, which is its base class
        # but not the same thing to an `except` clause.
        raise CalibrationError(str(exc)) from None
    return Calibration(
        a=got[0], B=got[1], cap=got[2], clamped=got[3], convex_flag=got[4],
        flag_reason=FlagReason(got[5]), drift=got[6], eta=got[7],
        split_hint=got[8], calib_delta=got[9], tangent_delta=got[10],
        note=got[11],
    )


def shortest_path(g, src, dst, *, banned_arcs=None, banned_nodes=None,
                  weights=None, max_hops=8):
    """`spfa` through the compiled search, or `None` if it is absent.

    Goes through the resident `Problem`, so the arcs and the adjacency cross
    once per graph rather than once per call -- Yen's algorithm runs this ~83
    times a quote.
    """
    problem = problem_for(g)
    if problem is None:
        return None
    return problem.shortest_path(
        int(src), int(dst),
        None if not banned_arcs else [int(v) for v in banned_arcs],
        None if not banned_nodes else [int(v) for v in banned_nodes],
        None if weights is None else np.asarray(weights, float).tolist(),
        int(max_hops),
    )


def cancel_cycles(tau, sig, psi, tol=1e-12, n_nodes=None):
    """Circulation removal through the compiled pass, or `None` if absent.

    The arrays are the candidate's own support, so nothing here is resident --
    but a full cancellation was 3.4 ms in Python against a whole quote of
    ~200 ms, because the peel runs `np.isin` per layer.
    """
    if _rust is None:
        return None
    flow, removed = _rust.cancel_cycles(
        np.asarray(tau, np.int64).tolist(),
        np.asarray(sig, np.int64).tolist(),
        np.asarray(psi, float).tolist(),
        float(tol),
        None if n_nodes is None else int(n_nodes),
    )
    return np.asarray(flow, float), int(removed)


def split_ascend(plan, start, free, *, min_weight, iters, sweeps, window,
                 sweep_tol):
    """The split search through the compiled ascent, or `None` if absent.

    `plan` is what `make_evaluator` published: the sampled curves and the leg
    wiring.  Nothing in the search quotes a pool, which is what lets the whole
    loop cross in one call rather than per evaluation.
    """
    if _rust is None:
        return None
    return _rust.split_ascend(
        plan["curves"], plan["src_of"], plan["dst_of"], plan["static_share"],
        plan["heads"], plan["tails"], int(plan["slots"]), int(plan["dst_slot"]),
        float(plan["amount_in"]), start, free, float(min_weight), int(iters),
        int(sweeps), float(window), float(sweep_tol),
    )
