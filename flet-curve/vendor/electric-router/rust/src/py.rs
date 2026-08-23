//! PyO3 bindings.  Behind the `python` feature so the same core compiles to a
//! bare wasm module with no Python in it at all.
//!
//! The boundary is one call per *solve*, not per pivot.  A quote runs ~45
//! solves and ~2,250 pivots, so crossing per pivot would pay the FFI cost 50x
//! more often for no benefit -- and it would leave the pivot loop in Python,
//! which is the part that costs.
//!
//! Arrays come in as plain Python sequences of floats and ints rather than as
//! numpy buffers.  That keeps the extension free of the numpy C API, which is
//! what lets the same wheel work under Pyodide, where matching numpy's ABI is
//! the fiddliest part of shipping a native module.

use pyo3::prelude::*;
use pyo3::types::{PyBytes, PyDict, PyTuple};

use crate::solve::{active_set_solve, Arcs, Options};

#[allow(clippy::too_many_arguments)]
#[pyfunction]
#[pyo3(signature = (tau, sig, g, eps, cap, n_nodes, src, dst, psi_total,
                    a0=None, forbidden=None, pinned=None, tol=None, maxit=600,
                    min_flow=0.0, gas_cost=0.0, partial_ok=false, rank1=None))]
fn solve<'py>(
    py: Python<'py>,
    tau: Vec<i64>,
    sig: Vec<i64>,
    g: Vec<f64>,
    eps: Vec<f64>,
    cap: Vec<f64>,
    n_nodes: usize,
    src: usize,
    dst: usize,
    psi_total: f64,
    a0: Option<Vec<bool>>,
    forbidden: Option<Vec<bool>>,
    pinned: Option<Vec<(usize, f64)>>,
    tol: Option<f64>,
    maxit: u32,
    min_flow: f64,
    gas_cost: f64,
    partial_ok: bool,
    rank1: Option<bool>,
) -> PyResult<Bound<'py, PyDict>> {
    let arcs = Arcs { tau: &tau, sig: &sig, g: &g, eps: &eps, cap: &cap, n_nodes };
    let opt = Options {
        tol: tol.unwrap_or(crate::solve::TOL),
        maxit,
        min_flow,
        gas_cost,
        partial_ok,
        rank1: rank1.unwrap_or(true),

    };
    let pins = pinned.unwrap_or_default();
    // The solve is pure arithmetic and can be long; let other Python threads
    // run while it does.
    let out = py.allow_threads(|| {
        active_set_solve(
            &arcs, src, dst, psi_total,
            a0.as_deref(), forbidden.as_deref(), &pins, &opt,
        )
    });

    pack(py, out)
}



/// The graph, held on the Rust side across a quote's many solves.
///
/// A quote runs 45-106 solves over *the same* arcs -- only the warm start, the
/// forbidden mask and the pins change between them.  Marshalling `tau`, `sig`,
/// `G`, `eps` and `cap` on every call meant crossing the boundary with tens of
/// thousands of Python floats per quote to hand over data that had not
/// changed, which cost about what the Rust arithmetic saved.
///
/// Building the problem once turns that into one crossing, and leaves only the
/// per-solve masks -- which are small, and genuinely different each time.
#[pyclass]
pub struct Problem {
    tau: Vec<i64>,
    sig: Vec<i64>,
    g: Vec<f64>,
    eps: Vec<f64>,
    cap: Vec<f64>,
    n_nodes: usize,
    /// Built on first use by `shortest_path` and kept: Yen's algorithm walks
    /// the same arcs dozens of times per quote.
    adj: Option<crate::seed::Adjacency>,
}

#[pymethods]
impl Problem {
    #[new]
    fn new(tau: Vec<i64>, sig: Vec<i64>, g: Vec<f64>, eps: Vec<f64>,
           cap: Vec<f64>, n_nodes: usize) -> Self {
        Problem { tau, sig, g, eps, cap, n_nodes, adj: None }
    }

    #[getter]
    fn m(&self) -> usize {
        self.tau.len()
    }

    /// Shortest `src -> dst` path over `weights` (or `eps`), §5.3.
    ///
    /// On the resident problem rather than a free function: Yen's algorithm
    /// calls this ~83 times a quote over the same arcs, and handing `tau`,
    /// `sig` and the adjacency across each time would cost what the search
    /// saves.  The adjacency is built once, on first use.
    #[pyo3(signature = (src, dst, banned_arcs=None, banned_nodes=None,
                        weights=None, max_hops=8))]
    fn shortest_path<'py>(
        &mut self,
        py: Python<'py>,
        src: usize,
        dst: usize,
        banned_arcs: Option<Vec<usize>>,
        banned_nodes: Option<Vec<usize>>,
        weights: Option<Vec<f64>>,
        max_hops: usize,
    ) -> PyResult<Bound<'py, PyDict>> {
        if self.adj.is_none() {
            self.adj = Some(crate::seed::build_adjacency(&self.tau, self.n_nodes));
        }
        let adj = self.adj.as_ref().unwrap();
        let m = self.tau.len();
        let mut arc_mask = vec![false; m];
        for p in banned_arcs.unwrap_or_default() {
            if p < m {
                arc_mask[p] = true;
            }
        }
        let mut node_mask = vec![false; self.n_nodes];
        for v in banned_nodes.unwrap_or_default() {
            if v < self.n_nodes {
                node_mask[v] = true;
            }
        }
        let cost = weights.unwrap_or_else(|| self.eps.clone());
        let got = py.allow_threads(|| {
            crate::seed::spfa(&self.tau, &self.sig, &cost, self.n_nodes, adj, src, dst,
                              &arc_mask, &node_mask, max_hops)
        });
        let d = PyDict::new(py);
        d.set_item("arcs", got.arcs)?;
        d.set_item("length", got.length)?;
        d.set_item("found", got.found)?;
        d.set_item("negative_cycle", got.negative_cycle)?;
        Ok(d)
    }

    #[allow(clippy::too_many_arguments)]
    #[pyo3(signature = (src, dst, psi_total, a0=None, forbidden=None, pinned=None,
                        tol=None, maxit=600, min_flow=0.0, gas_cost=0.0,
                        partial_ok=false, rank1=None))]

    fn solve<'py>(
        &self,
        py: Python<'py>,
        src: usize,
        dst: usize,
        psi_total: f64,
        a0: Option<Vec<bool>>,
        forbidden: Option<Vec<bool>>,
        pinned: Option<Vec<(usize, f64)>>,
        tol: Option<f64>,
        maxit: u32,
        min_flow: f64,
        gas_cost: f64,
        partial_ok: bool,
        rank1: Option<bool>,
    ) -> PyResult<Bound<'py, PyDict>> {
        let arcs = Arcs {
            tau: &self.tau, sig: &self.sig, g: &self.g,
            eps: &self.eps, cap: &self.cap, n_nodes: self.n_nodes,
        };
        let opt = Options {
            tol: tol.unwrap_or(crate::solve::TOL),
            maxit, min_flow, gas_cost, partial_ok,
            rank1: rank1.unwrap_or(true),
        };
        let pins = pinned.unwrap_or_default();
        let out = py.allow_threads(|| {
            active_set_solve(&arcs, src, dst, psi_total,
                             a0.as_deref(), forbidden.as_deref(), &pins, &opt)
        });
        pack(py, out)
    }
}

/// One arc's ladder, fitted.  Returns the fields of `core.calibrate.Calibration`
/// as a tuple, in declaration order, so the Python side builds the dataclass
/// and keeps its own postconditions.
#[allow(clippy::too_many_arguments)]
#[pyfunction]
#[pyo3(signature = (deltas, quotes, delta_bar=None, structural_flag=false,
                    drift_tol=crate::calibrate::DRIFT_TOL, cap=None,
                    f_at_cap=None, quantum=0.0))]
fn calibrate<'py>(
    py: Python<'py>,
    deltas: Vec<f64>,
    quotes: Vec<f64>,
    delta_bar: Option<f64>,
    structural_flag: bool,
    drift_tol: f64,
    cap: Option<f64>,
    f_at_cap: Option<f64>,
    quantum: f64,
) -> PyResult<Bound<'py, PyTuple>> {
    let got = crate::calibrate::calibrate(
        &deltas, &quotes, delta_bar, structural_flag, drift_tol, cap, f_at_cap, quantum,
    )
    .map_err(|e| pyo3::exceptions::PyValueError::new_err(e.0))?;
    PyTuple::new(
        py,
        [
            got.a.into_pyobject(py)?.into_any(),
            got.b.into_pyobject(py)?.into_any(),
            got.cap.into_pyobject(py)?.into_any(),
            got.clamped.into_pyobject(py)?.to_owned().into_any(),
            got.convex_flag.into_pyobject(py)?.to_owned().into_any(),
            got.flag.as_str().into_pyobject(py)?.into_any(),
            got.drift.into_pyobject(py)?.into_any(),
            got.eta.into_pyobject(py)?.into_any(),
            got.split_hint.into_pyobject(py)?.to_owned().into_any(),
            got.calib_delta.into_pyobject(py)?.into_any(),
            got.tangent_delta.into_pyobject(py)?.into_any(),
            got.note.into_pyobject(py)?.into_any(),
        ],
    )
}

/// Remove circulation from a flow (§5.6).  Returns `(flow, removed)`.
///
/// A free function rather than a `Problem` method: `cancel_cycles` is called
/// on sub-arrays of a candidate's own support, whose indices are not the
/// graph's, so there is nothing resident to reuse.
#[pyfunction]
#[pyo3(signature = (tau, sig, psi, tol=1e-12, n_nodes=None))]
fn cancel_cycles<'py>(
    py: Python<'py>,
    tau: Vec<i64>,
    sig: Vec<i64>,
    psi: Vec<f64>,
    tol: f64,
    n_nodes: Option<usize>,
) -> PyResult<(Vec<f64>, usize)> {
    let n = n_nodes.unwrap_or_else(|| {
        let hi = tau.iter().chain(sig.iter()).copied().max().unwrap_or(-1);
        (hi + 1).max(0) as usize
    });
    Ok(py.allow_threads(|| crate::cycles::cancel_cycles(&tau, &sig, &psi, tol, n)))
}

/// One directed cycle as arc indices, or `None`.
#[pyfunction]
#[pyo3(signature = (tau, sig, n_nodes=None))]
fn find_cycle(
    tau: Vec<i64>,
    sig: Vec<i64>,
    n_nodes: Option<usize>,
) -> PyResult<Option<Vec<usize>>> {
    let n = n_nodes.unwrap_or_else(|| {
        let hi = tau.iter().chain(sig.iter()).copied().max().unwrap_or(-1);
        (hi + 1).max(0) as usize
    });
    Ok(crate::cycles::find_cycle(&tau, &sig, n))
}

/// `f64` slice as native-endian bytes.
///
/// A list of 778 floats is 778 `PyFloat` allocations that numpy then walks
/// one by one -- 14 us, against 0.95 us for `frombuffer` over the same
/// numbers.  Six of those per solve was 80 us a solve and the largest piece
/// of pure overhead left in a quote.
///
/// Still no numpy C API on this side: Rust hands over plain `bytes` and the
/// Python builds the array, so the wheel stays the same one that loads in
/// Pyodide.
fn floats<'py>(py: Python<'py>, v: &[f64]) -> Bound<'py, PyBytes> {
    let mut raw = Vec::with_capacity(v.len() * 8);
    for x in v {
        raw.extend_from_slice(&x.to_ne_bytes());
    }
    PyBytes::new(py, &raw)
}

fn flags<'py>(py: Python<'py>, v: &[bool]) -> Bound<'py, PyBytes> {
    let raw: Vec<u8> = v.iter().map(|&b| b as u8).collect();
    PyBytes::new(py, &raw)
}

/// Coordinate ascent over a route's split (§6.4).
///
/// Everything crosses once: the sampled curves, the leg wiring and the
/// starting weights go in, the optimised weights come back.  The search runs
/// ~100,000 evaluations inside, none of which touch Python.
#[allow(clippy::too_many_arguments)]
#[pyfunction]
#[pyo3(signature = (curves, src_of, dst_of, static_share, heads, tails, slots,
                    dst_slot, amount_in, start, free, min_weight, iters,
                    sweeps, window, sweep_tol))]
fn split_ascend<'py>(
    py: Python<'py>,
    curves: Vec<(Vec<f64>, Vec<f64>, Vec<f64>, f64, f64)>,
    src_of: Vec<usize>,
    dst_of: Vec<usize>,
    static_share: Vec<Option<f64>>,
    heads: Vec<Vec<usize>>,
    tails: Vec<usize>,
    slots: usize,
    dst_slot: usize,
    amount_in: f64,
    start: Vec<Vec<f64>>,
    free: Vec<(usize, usize)>,
    min_weight: f64,
    iters: usize,
    sweeps: usize,
    window: f64,
    sweep_tol: f64,
) -> PyResult<(Vec<Vec<f64>>, f64, usize)> {
    let plan = crate::split::Plan {
        curves: curves
            .into_iter()
            .map(|(x, u, slope, rate0, tail)| crate::split::Curve { x, u, slope, rate0, tail })
            .collect(),
        src_of, dst_of, static_share, heads, tails, slots, dst_slot, amount_in,
        min_weight,
    };
    let got = py.allow_threads(|| {
        crate::split::ascend(&plan, &start, &free, iters, sweeps, window, sweep_tol)
    });
    Ok((got.weights, got.best, got.evaluations))
}

fn pack<'py>(py: Python<'py>, out: crate::solve::Solution) -> PyResult<Bound<'py, PyDict>> {
    let d = PyDict::new(py);
    d.set_item("psi", floats(py, &out.psi))?;
    d.set_item("u", floats(py, &out.u))?;
    d.set_item("active", flags(py, &out.active))?;
    d.set_item("upper", flags(py, &out.upper))?;
    d.set_item("psi_upper", floats(py, &out.psi_upper))?;
    d.set_item("rho", floats(py, &out.rho))?;
    d.set_item("pivots", out.pivots)?;
    d.set_item("chol_failures", out.chol_failures)?;
    d.set_item("keep_changes", out.keep_changes)?;
    d.set_item("refits", out.refits)?;
    d.set_item("timings", out.timings.to_vec())?;
    d.set_item("feasible", out.stop.feasible())?;
    d.set_item("reason", out.stop.reason())?;
    Ok(d)
}

#[pymodule]
fn erouter_solve(m: &Bound<'_, PyModule>) -> PyResult<()> {
    m.add_function(wrap_pyfunction!(solve, m)?)?;
    m.add_function(wrap_pyfunction!(calibrate, m)?)?;
    m.add_function(wrap_pyfunction!(cancel_cycles, m)?)?;
    m.add_function(wrap_pyfunction!(find_cycle, m)?)?;
    m.add_function(wrap_pyfunction!(split_ascend, m)?)?;
    m.add_class::<Problem>()?;
    m.add("__doc__", "The router's active-set QP, in Rust.")?;
    Ok(())
}
