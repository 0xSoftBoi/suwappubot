//! The solver's exports.
//!
//! One for one with `rust/src/py.rs`, because the Python shim that stands in
//! for `erouter_solve` in the browser has to present the same surface to
//! `core/accel.py` -- which is not allowed to know which one it got.
//!
//! Arrays cross as typed arrays and come back as `Float64Array` /
//! `Uint8Array`, which is the same "plain buffers, no numpy" boundary the
//! PyO3 side uses.  Nothing here is a `serde` structure: the shapes are known
//! and flattening them by hand keeps the module free of a JSON round trip on
//! the per-keystroke path.

use erouter_solve::calibrate::calibrate as calibrate_ladder;
use erouter_solve::seed::{build_adjacency, spfa, Adjacency};
use erouter_solve::solve::{active_set_solve, Arcs, Options, Solution};
use erouter_solve::split::{ascend, Curve, Plan};
use wasm_bindgen::prelude::*;

/// A solve's answer.  Getters rather than fields so the vectors are only
/// materialised as JS arrays when the caller asks for them.
#[wasm_bindgen]
pub struct SolveResult {
    inner: Solution,
}

#[wasm_bindgen]
impl SolveResult {
    #[wasm_bindgen(getter)]
    pub fn psi(&self) -> Vec<f64> {
        self.inner.psi.clone()
    }
    #[wasm_bindgen(getter)]
    pub fn u(&self) -> Vec<f64> {
        self.inner.u.clone()
    }
    #[wasm_bindgen(getter)]
    pub fn active(&self) -> Vec<u8> {
        self.inner.active.iter().map(|&b| b as u8).collect()
    }
    #[wasm_bindgen(getter)]
    pub fn upper(&self) -> Vec<u8> {
        self.inner.upper.iter().map(|&b| b as u8).collect()
    }
    #[wasm_bindgen(getter, js_name = psiUpper)]
    pub fn psi_upper(&self) -> Vec<f64> {
        self.inner.psi_upper.clone()
    }
    #[wasm_bindgen(getter)]
    pub fn rho(&self) -> Vec<f64> {
        self.inner.rho.clone()
    }
    #[wasm_bindgen(getter)]
    pub fn pivots(&self) -> u32 {
        self.inner.pivots as u32
    }
    #[wasm_bindgen(getter, js_name = cholFailures)]
    pub fn chol_failures(&self) -> u32 {
        self.inner.chol_failures as u32
    }
    #[wasm_bindgen(getter, js_name = keepChanges)]
    pub fn keep_changes(&self) -> u32 {
        self.inner.keep_changes as u32
    }
    #[wasm_bindgen(getter)]
    pub fn refits(&self) -> u32 {
        self.inner.refits as u32
    }
    /// Nanoseconds per section of the pivot loop, and all zero unless the
    /// crate was built with `--features bench` -- which the browser build
    /// never is, since a Worker has no clock to read.  `f64` rather than
    /// `u64` so it arrives as a number array instead of `BigInt64Array`.
    #[wasm_bindgen(getter)]
    pub fn timings(&self) -> Vec<f64> {
        self.inner.timings.iter().map(|&v| v as f64).collect()
    }
    #[wasm_bindgen(getter)]
    pub fn feasible(&self) -> bool {
        self.inner.stop.feasible()
    }
    #[wasm_bindgen(getter)]
    pub fn reason(&self) -> String {
        self.inner.stop.reason().to_string()
    }
}

/// The graph, held across a quote's 45-106 solves.  Same reason as the PyO3
/// `Problem`: only the warm start, the forbidden mask and the pins change.
#[wasm_bindgen]
pub struct Problem {
    tau: Vec<i64>,
    sig: Vec<i64>,
    g: Vec<f64>,
    eps: Vec<f64>,
    cap: Vec<f64>,
    n_nodes: usize,
    adj: Option<Adjacency>,
}

#[wasm_bindgen]
impl Problem {
    #[wasm_bindgen(constructor)]
    pub fn new(
        tau: &[i32],
        sig: &[i32],
        g: &[f64],
        eps: &[f64],
        cap: &[f64],
        n_nodes: usize,
    ) -> Result<Problem, JsError> {
        let m = tau.len();
        if sig.len() != m || g.len() != m || eps.len() != m || cap.len() != m {
            return Err(JsError::new("tau, sig, g, eps and cap must be the same length"));
        }
        Ok(Problem {
            tau: tau.iter().map(|&v| v as i64).collect(),
            sig: sig.iter().map(|&v| v as i64).collect(),
            g: g.to_vec(),
            eps: eps.to_vec(),
            cap: cap.to_vec(),
            n_nodes,
            adj: None,
        })
    }

    #[wasm_bindgen(getter)]
    pub fn m(&self) -> usize {
        self.tau.len()
    }

    /// `{arcs, length, found, negativeCycle}` as four getters on one struct --
    /// see `PathResult`.
    #[wasm_bindgen(js_name = shortestPath)]
    pub fn shortest_path(
        &mut self,
        src: usize,
        dst: usize,
        banned_arcs: Option<Vec<u32>>,
        banned_nodes: Option<Vec<u32>>,
        weights: Option<Vec<f64>>,
        max_hops: usize,
    ) -> PathResult {
        if self.adj.is_none() {
            self.adj = Some(build_adjacency(&self.tau, self.n_nodes));
        }
        let adj = self.adj.as_ref().unwrap();
        let m = self.tau.len();
        let mut arc_mask = vec![false; m];
        for p in banned_arcs.unwrap_or_default() {
            let p = p as usize;
            if p < m {
                arc_mask[p] = true;
            }
        }
        let mut node_mask = vec![false; self.n_nodes];
        for v in banned_nodes.unwrap_or_default() {
            let v = v as usize;
            if v < self.n_nodes {
                node_mask[v] = true;
            }
        }
        let cost = weights.unwrap_or_else(|| self.eps.clone());
        let got = spfa(
            &self.tau, &self.sig, &cost, self.n_nodes, adj, src, dst,
            &arc_mask, &node_mask, max_hops,
        );
        PathResult {
            arcs: got.arcs.iter().map(|&v| v as u32).collect(),
            length: got.length,
            found: got.found,
            negative_cycle: got.negative_cycle.iter().map(|&v| v as u32).collect(),
        }
    }

    /// `a0` and `forbidden` are `Uint8Array` masks; empty means absent, which
    /// is how a JS caller says `None` without a nullable typed array.
    /// `pinned` is two parallel arrays for the same reason.
    #[allow(clippy::too_many_arguments)]
    pub fn solve(
        &self,
        src: usize,
        dst: usize,
        psi_total: f64,
        a0: &[u8],
        forbidden: &[u8],
        pinned_arc: &[u32],
        pinned_value: &[f64],
        tol: f64,
        maxit: u32,
        min_flow: f64,
        gas_cost: f64,
        partial_ok: bool,
        rank1: bool,
    ) -> Result<SolveResult, JsError> {
        let m = self.tau.len();
        if !a0.is_empty() && a0.len() != m {
            return Err(JsError::new("a0 must be empty or one flag per arc"));
        }
        if !forbidden.is_empty() && forbidden.len() != m {
            return Err(JsError::new("forbidden must be empty or one flag per arc"));
        }
        if pinned_arc.len() != pinned_value.len() {
            return Err(JsError::new("pinned_arc and pinned_value must be the same length"));
        }
        let arcs = Arcs {
            tau: &self.tau, sig: &self.sig, g: &self.g,
            eps: &self.eps, cap: &self.cap, n_nodes: self.n_nodes,
        };
        let opt = Options { tol, maxit, min_flow, gas_cost, partial_ok, rank1 };
        let pins: Vec<(usize, f64)> = pinned_arc
            .iter()
            .zip(pinned_value.iter())
            .map(|(&p, &v)| (p as usize, v))
            .collect();
        let seed = mask(a0);
        let banned = mask(forbidden);
        let out = active_set_solve(
            &arcs, src, dst, psi_total,
            seed.as_deref(), banned.as_deref(), &pins, &opt,
        );
        Ok(SolveResult { inner: out })
    }
}

#[wasm_bindgen]
pub struct PathResult {
    arcs: Vec<u32>,
    length: f64,
    found: bool,
    /// The cycle's arcs when the search met a negative one, else empty -- not
    /// a flag, because the caller reports which arcs.
    negative_cycle: Vec<u32>,
}

#[wasm_bindgen]
impl PathResult {
    #[wasm_bindgen(getter)]
    pub fn arcs(&self) -> Vec<u32> {
        self.arcs.clone()
    }
    #[wasm_bindgen(getter)]
    pub fn length(&self) -> f64 {
        self.length
    }
    #[wasm_bindgen(getter)]
    pub fn found(&self) -> bool {
        self.found
    }
    #[wasm_bindgen(getter, js_name = negativeCycle)]
    pub fn negative_cycle(&self) -> Vec<u32> {
        self.negative_cycle.clone()
    }
}

fn mask(raw: &[u8]) -> Option<Vec<bool>> {
    if raw.is_empty() {
        None
    } else {
        Some(raw.iter().map(|&b| b != 0).collect())
    }
}

/// One arc's ladder, fitted.  The twelve `Calibration` fields, in declaration
/// order, so the Python side builds the dataclass and keeps its own
/// postconditions -- exactly as the PyO3 tuple does.
#[wasm_bindgen]
pub struct CalibrationOut {
    a: f64,
    b: f64,
    cap: f64,
    clamped: bool,
    convex_flag: bool,
    flag: String,
    drift: f64,
    eta: f64,
    split_hint: bool,
    calib_delta: f64,
    tangent_delta: f64,
    note: String,
}

#[wasm_bindgen]
impl CalibrationOut {
    #[wasm_bindgen(getter)]
    pub fn a(&self) -> f64 { self.a }
    #[wasm_bindgen(getter)]
    pub fn b(&self) -> f64 { self.b }
    #[wasm_bindgen(getter)]
    pub fn cap(&self) -> f64 { self.cap }
    #[wasm_bindgen(getter)]
    pub fn clamped(&self) -> bool { self.clamped }
    #[wasm_bindgen(getter, js_name = convexFlag)]
    pub fn convex_flag(&self) -> bool { self.convex_flag }
    #[wasm_bindgen(getter)]
    pub fn flag(&self) -> String { self.flag.clone() }
    #[wasm_bindgen(getter)]
    pub fn drift(&self) -> f64 { self.drift }
    #[wasm_bindgen(getter)]
    pub fn eta(&self) -> f64 { self.eta }
    #[wasm_bindgen(getter, js_name = splitHint)]
    pub fn split_hint(&self) -> bool { self.split_hint }
    #[wasm_bindgen(getter, js_name = calibDelta)]
    pub fn calib_delta(&self) -> f64 { self.calib_delta }
    #[wasm_bindgen(getter, js_name = tangentDelta)]
    pub fn tangent_delta(&self) -> f64 { self.tangent_delta }
    #[wasm_bindgen(getter)]
    pub fn note(&self) -> String { self.note.clone() }
}

/// `delta_bar`, `cap` and `f_at_cap` are optional; NaN says absent, which is
/// how an `f64` parameter carries `None` without a boxed value per call.
#[allow(clippy::too_many_arguments)]
#[wasm_bindgen]
pub fn calibrate(
    deltas: &[f64],
    quotes: &[f64],
    delta_bar: f64,
    structural_flag: bool,
    drift_tol: f64,
    cap: f64,
    f_at_cap: f64,
    quantum: f64,
) -> Result<CalibrationOut, JsError> {
    let got = calibrate_ladder(
        deltas,
        quotes,
        maybe(delta_bar),
        structural_flag,
        drift_tol,
        maybe(cap),
        maybe(f_at_cap),
        quantum,
    )
    .map_err(|e| JsError::new(&e.0))?;
    Ok(CalibrationOut {
        a: got.a,
        b: got.b,
        cap: got.cap,
        clamped: got.clamped,
        convex_flag: got.convex_flag,
        flag: got.flag.as_str().to_string(),
        drift: got.drift,
        eta: got.eta,
        split_hint: got.split_hint,
        calib_delta: got.calib_delta,
        tangent_delta: got.tangent_delta,
        note: got.note.to_string(),
    })
}

fn maybe(value: f64) -> Option<f64> {
    if value.is_nan() {
        None
    } else {
        Some(value)
    }
}

#[wasm_bindgen]
pub struct CycleResult {
    flow: Vec<f64>,
    removed: u32,
}

#[wasm_bindgen]
impl CycleResult {
    #[wasm_bindgen(getter)]
    pub fn flow(&self) -> Vec<f64> { self.flow.clone() }
    #[wasm_bindgen(getter)]
    pub fn removed(&self) -> u32 { self.removed }
}

/// `n_nodes` of 0 means "work it out from the arcs", as `None` does in Python.
#[wasm_bindgen(js_name = cancelCycles)]
pub fn cancel_cycles(tau: &[i32], sig: &[i32], psi: &[f64], tol: f64, n_nodes: usize) -> CycleResult {
    let tau: Vec<i64> = tau.iter().map(|&v| v as i64).collect();
    let sig: Vec<i64> = sig.iter().map(|&v| v as i64).collect();
    let n = if n_nodes == 0 { node_count(&tau, &sig) } else { n_nodes };
    let (flow, removed) = erouter_solve::cycles::cancel_cycles(&tau, &sig, psi, tol, n);
    CycleResult { flow, removed: removed as u32 }
}

/// The cycle's arcs, or an empty array when there is none.
#[wasm_bindgen(js_name = findCycle)]
pub fn find_cycle(tau: &[i32], sig: &[i32], n_nodes: usize) -> Vec<u32> {
    let tau: Vec<i64> = tau.iter().map(|&v| v as i64).collect();
    let sig: Vec<i64> = sig.iter().map(|&v| v as i64).collect();
    let n = if n_nodes == 0 { node_count(&tau, &sig) } else { n_nodes };
    erouter_solve::cycles::find_cycle(&tau, &sig, n)
        .map(|v| v.into_iter().map(|x| x as u32).collect())
        .unwrap_or_default()
}

fn node_count(tau: &[i64], sig: &[i64]) -> usize {
    let hi = tau.iter().chain(sig.iter()).copied().max().unwrap_or(-1);
    (hi + 1).max(0) as usize
}

#[wasm_bindgen]
pub struct AscendResult {
    weights: Vec<f64>,
    offsets: Vec<u32>,
    best: f64,
    evaluations: u32,
}

#[wasm_bindgen]
impl AscendResult {
    /// Every slot's weights, end to end; `offsets` says where each begins.
    #[wasm_bindgen(getter)]
    pub fn weights(&self) -> Vec<f64> { self.weights.clone() }
    #[wasm_bindgen(getter)]
    pub fn offsets(&self) -> Vec<u32> { self.offsets.clone() }
    #[wasm_bindgen(getter)]
    pub fn best(&self) -> f64 { self.best }
    #[wasm_bindgen(getter)]
    pub fn evaluations(&self) -> u32 { self.evaluations }
}

/// Coordinate ascent over a route's split.
///
/// Everything ragged arrives flattened with an offsets array beside it --
/// curves, heads, starting weights.  A JSON payload would be simpler to write
/// and this runs on the per-keystroke path, where a 200 kB parse per quote is
/// not free.  `static_share` uses NaN for "not fixed".
#[allow(clippy::too_many_arguments)]
#[wasm_bindgen(js_name = splitAscend)]
pub fn split_ascend(
    curve_x: &[f64],
    curve_u: &[f64],
    curve_slope: &[f64],
    curve_off: &[u32],
    slope_off: &[u32],
    curve_rate0: &[f64],
    curve_tail: &[f64],
    src_of: &[u32],
    dst_of: &[u32],
    static_share: &[f64],
    heads_flat: &[u32],
    heads_off: &[u32],
    tails: &[u32],
    slots: usize,
    dst_slot: usize,
    amount_in: f64,
    start_flat: &[f64],
    start_off: &[u32],
    free_slot: &[u32],
    free_index: &[u32],
    min_weight: f64,
    iters: usize,
    sweeps: usize,
    window: f64,
    sweep_tol: f64,
) -> Result<AscendResult, JsError> {
    let n_curves = curve_off.len().saturating_sub(1);
    if curve_rate0.len() != n_curves || curve_tail.len() != n_curves {
        return Err(JsError::new("curve_rate0/curve_tail must have one entry per curve"));
    }
    if slope_off.len() != curve_off.len() {
        return Err(JsError::new("slope_off must have one entry per curve boundary"));
    }
    let mut curves = Vec::with_capacity(n_curves);
    for k in 0..n_curves {
        // `slope` has its own offsets rather than sharing `x`'s: it is
        // `diff(u) / diff(x)` and so is one shorter than both, which a single
        // offsets array silently overruns on the last curve.
        let (lo, hi) = (curve_off[k] as usize, curve_off[k + 1] as usize);
        let (slo, shi) = (slope_off[k] as usize, slope_off[k + 1] as usize);
        if hi > curve_x.len() || hi > curve_u.len() || lo > hi {
            return Err(JsError::new("curve offsets run past the flattened arrays"));
        }
        if shi > curve_slope.len() || slo > shi {
            return Err(JsError::new("slope offsets run past the flattened array"));
        }
        curves.push(Curve {
            x: curve_x[lo..hi].to_vec(),
            u: curve_u[lo..hi].to_vec(),
            slope: curve_slope[slo..shi].to_vec(),
            rate0: curve_rate0[k],
            tail: curve_tail[k],
        });
    }
    let plan = Plan {
        curves,
        src_of: src_of.iter().map(|&v| v as usize).collect(),
        dst_of: dst_of.iter().map(|&v| v as usize).collect(),
        static_share: static_share.iter().map(|&v| maybe(v)).collect(),
        heads: ragged_u32(heads_flat, heads_off)?,
        tails: tails.iter().map(|&v| v as usize).collect(),
        slots,
        dst_slot,
        amount_in,
        min_weight,
    };
    let start = ragged_f64(start_flat, start_off)?;
    let free: Vec<(usize, usize)> = free_slot
        .iter()
        .zip(free_index.iter())
        .map(|(&s, &i)| (s as usize, i as usize))
        .collect();
    let got = ascend(&plan, &start, &free, iters, sweeps, window, sweep_tol);
    let mut weights = Vec::new();
    let mut offsets = Vec::with_capacity(got.weights.len() + 1);
    offsets.push(0u32);
    for row in &got.weights {
        weights.extend_from_slice(row);
        offsets.push(weights.len() as u32);
    }
    Ok(AscendResult { weights, offsets, best: got.best, evaluations: got.evaluations as u32 })
}

fn ragged_u32(flat: &[u32], off: &[u32]) -> Result<Vec<Vec<usize>>, JsError> {
    let mut out = Vec::with_capacity(off.len().saturating_sub(1));
    for pair in off.windows(2) {
        let (lo, hi) = (pair[0] as usize, pair[1] as usize);
        if lo > hi || hi > flat.len() {
            return Err(JsError::new("offsets run past the flattened array"));
        }
        out.push(flat[lo..hi].iter().map(|&v| v as usize).collect());
    }
    Ok(out)
}

fn ragged_f64(flat: &[f64], off: &[u32]) -> Result<Vec<Vec<f64>>, JsError> {
    let mut out = Vec::with_capacity(off.len().saturating_sub(1));
    for pair in off.windows(2) {
        let (lo, hi) = (pair[0] as usize, pair[1] as usize);
        if lo > hi || hi > flat.len() {
            return Err(JsError::new("offsets run past the flattened array"));
        }
        out.push(flat[lo..hi].to_vec());
    }
    Ok(out)
}
