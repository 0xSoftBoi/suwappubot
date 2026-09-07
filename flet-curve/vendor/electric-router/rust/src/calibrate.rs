//! One arc's probe ladder, fitted (spec §2.3, §2.6).
//!
//! A port of `core/calibrate.py`, which stays the reference: it is the only
//! place a `B` is produced, and `B >= 0` plus `clamped => cap finite` are its
//! postconditions rather than something the solver guards against.
//!
//! The arrays here are six elements long.  That is the whole reason this is
//! worth compiling: the Python runs `np.diff`, `np.interp` and `np.concatenate`
//! over six floats, and a single `np.diff` pair costs 5 us against nanoseconds
//! of arithmetic -- 50 us per call, 736 calls a quote.  Nothing about the
//! arithmetic is hard; the dispatch was the cost.

pub const DRIFT_TOL: f64 = 0.25;
pub const SATURATION_TOL: f64 = 1e-9;
pub const DUPLICATE_TOL: f64 = 1e-6;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Flag {
    None,
    DividedDiff,
    Structural,
    Clamped,
    Both,
}

impl Flag {
    pub fn as_str(self) -> &'static str {
        match self {
            Flag::None => "NONE",
            Flag::DividedDiff => "DIVIDED_DIFF",
            Flag::Structural => "STRUCTURAL",
            Flag::Clamped => "CLAMPED",
            Flag::Both => "BOTH",
        }
    }
}

#[derive(Debug)]
pub struct Calibration {
    pub a: f64,
    pub b: f64,
    pub cap: f64,
    pub clamped: bool,
    pub convex_flag: bool,
    pub flag: Flag,
    pub drift: f64,
    pub eta: f64,
    pub split_hint: bool,
    pub calib_delta: f64,
    pub tangent_delta: f64,
    pub note: &'static str,
}

#[derive(Debug)]
pub struct CalibrationError(pub String);

/// `f[x_k, x_k+1, x_k+2]` for each consecutive triple.
fn second_divided(x: &[f64], y: &[f64], out: &mut Vec<f64>) {
    out.clear();
    if x.len() < 3 {
        return;
    }
    for k in 0..(x.len() - 2) {
        let first_a = (y[k + 1] - y[k]) / (x[k + 1] - x[k]);
        let first_b = (y[k + 2] - y[k + 1]) / (x[k + 2] - x[k + 1]);
        out.push((first_b - first_a) / (x[k + 2] - x[k]));
    }
}

/// `numpy.interp` for a single point on an increasing `x`.
///
/// Matches numpy's own form -- `slope * (xq - x[i]) + y[i]`, clamped to the
/// endpoints outside the range -- because the result feeds `B`, and the two
/// spellings of a linear interpolation do not agree in the last bit.
fn interp(xq: f64, x: &[f64], y: &[f64]) -> f64 {
    let n = x.len();
    if n == 0 {
        return f64::NAN;
    }
    if xq <= x[0] {
        return y[0];
    }
    if xq >= x[n - 1] {
        return y[n - 1];
    }
    let mut lo = 0usize;
    let mut hi = n - 1;
    while hi - lo > 1 {
        let mid = (lo + hi) / 2;
        if x[mid] <= xq {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    let slope = (y[lo + 1] - y[lo]) / (x[lo + 1] - x[lo]);
    let res = slope * (xq - x[lo]) + y[lo];
    if res.is_finite() {
        res
    } else {
        slope * (xq - x[lo + 1]) + y[lo + 1]
    }
}

fn sign(v: f64) -> i32 {
    if v > 0.0 {
        1
    } else if v < 0.0 {
        -1
    } else {
        0
    }
}

#[allow(clippy::too_many_arguments)]
pub fn calibrate(
    deltas: &[f64],
    quotes: &[f64],
    delta_bar: Option<f64>,
    structural_flag: bool,
    drift_tol: f64,
    cap_in: Option<f64>,
    f_at_cap_in: Option<f64>,
    quantum: f64,
) -> Result<Calibration, CalibrationError> {
    if deltas.len() != quotes.len() {
        return Err(CalibrationError(
            "deltas and quotes must be 1-D and the same length".into(),
        ));
    }
    if deltas.len() < 2 {
        return Err(CalibrationError(format!(
            "need at least 2 probes, got {}",
            deltas.len()
        )));
    }
    for k in 1..deltas.len() {
        if !(deltas[k] > deltas[k - 1]) {
            return Err(CalibrationError("deltas must be strictly increasing".into()));
        }
    }
    for &v in quotes {
        if !(v > 0.0) {
            return Err(CalibrationError(
                "all quotes must be positive; drop failed probes first".into(),
            ));
        }
    }

    // Two nodes at the same size are one probe, and the wall test below cannot
    // read them as anything but saturation.
    let mut x: Vec<f64> = Vec::with_capacity(deltas.len());
    let mut y: Vec<f64> = Vec::with_capacity(quotes.len());
    x.push(deltas[0]);
    y.push(quotes[0]);
    for k in 1..deltas.len() {
        if deltas[k] - deltas[k - 1] > deltas[k - 1] * DUPLICATE_TOL {
            x.push(deltas[k]);
            y.push(quotes[k]);
        }
    }
    if x.len() < 2 {
        return Err(CalibrationError(
            "need at least 2 probes at distinct sizes, got 1 after collapsing duplicates".into(),
        ));
    }

    let tangent_delta = x[0];
    let mut a = y[0] / x[0];

    // --- capacity wall (§2.3 rule 2) -------------------------------------
    let mut saturated_at: Option<f64> = None;
    for k in 1..x.len() {
        if y[k] <= y[k - 1] * (1.0 + SATURATION_TOL) {
            saturated_at = Some(x[k - 1]);
            x.truncate(k);
            y.truncate(k);
            break;
        }
    }
    if let Some(wall) = saturated_at {
        if x.len() == 1 {
            return Ok(Calibration {
                a,
                b: 0.0,
                cap: wall,
                clamped: true,
                convex_flag: true,
                flag: Flag::Clamped,
                drift: 0.0,
                eta: f64::NAN,
                split_hint: false,
                calib_delta: wall,
                tangent_delta,
                note: "SATURATED",
            });
        }
    }

    let mut cap = match (saturated_at, cap_in) {
        (Some(wall), None) => Some(wall),
        (Some(wall), Some(c)) => Some(c.min(wall)),
        (None, c) => c,
    };
    let d_bar = delta_bar.unwrap_or_else(|| x[x.len() - 1]);
    let f_bar = interp(d_bar, &x, &y);
    let mut b = 2.0 * (a * d_bar - f_bar) / (d_bar * d_bar);

    // --- what the output token's own resolution can fake ------------------
    let mut noise = 0.0;
    if quantum > 0.0 {
        noise = 2.0 * (quantum / x[0]) / d_bar + 2.0 * quantum / (d_bar * d_bar);
    }
    let quantised = b < 0.0 && -b <= noise;
    if quantised {
        b = noise;
    }

    // Flag detection uses every probe, so a convex patch anywhere is caught.
    let mut xs = Vec::with_capacity(x.len() + 1);
    let mut ys = Vec::with_capacity(y.len() + 1);
    xs.push(0.0);
    ys.push(0.0);
    xs.extend_from_slice(&x);
    ys.extend_from_slice(&y);
    let mut dd = Vec::new();
    second_divided(&xs, &ys, &mut dd);
    let any_positive = dd.iter().any(|&v| v > 0.0);
    let mixed_signs = dd.len() > 1 && {
        let first = sign(dd[0]);
        dd.iter().any(|&v| sign(v) != first)
    };
    let numeric_flag = any_positive || mixed_signs;

    // DRIFT and eta use the local window {0, d/4, d/2, d} of §2.3.
    let mut drift = 0.0;
    let mut eta = f64::NAN;
    if x.len() >= 3 {
        let tail = x.len() - 3;
        let xs_local = [0.0, x[tail], x[tail + 1], x[tail + 2]];
        let ys_local = [0.0, y[tail], y[tail + 1], y[tail + 2]];
        let mut d_local = Vec::new();
        second_divided(&xs_local, &ys_local, &mut d_local);
        if d_local[0] != 0.0 {
            drift = d_local[1] / d_local[0] - 1.0;
        }
        if d_local[1] != 0.0 {
            let d3 = (d_local[1] - d_local[0]) / (xs_local[3] - xs_local[0]);
            eta = 3.0 * a * d3 / (2.0 * d_local[1] * d_local[1]);
        }
    }

    let mut note = if saturated_at.is_some() { "SATURATED" } else { "" };
    if quantised {
        note = "QUANTISED";
    }
    let clamped = b <= 0.0 || saturated_at.is_some();
    let mut flag = match (numeric_flag, structural_flag) {
        (true, true) => Flag::Both,
        (true, false) => Flag::DividedDiff,
        (false, true) => Flag::Structural,
        (false, false) => Flag::None,
    };

    let mut f_at_cap = f_at_cap_in;
    if clamped {
        // §2.3 zero-curvature clamp: the chord, not the tangent.
        if cap.map_or(true, |c| !c.is_finite()) {
            cap = Some(x[x.len() - 1]);
            f_at_cap = Some(y[y.len() - 1]);
            note = "CAP_FROM_LADDER";
        }
        let cap_value = cap.unwrap();
        let f_cap = match f_at_cap {
            Some(v) => v,
            None => interp(cap_value, &x, &y),
        };
        if !(f_cap > 0.0) {
            return Err(CalibrationError(
                "clamped arc needs a positive f(cap) for the chord".into(),
            ));
        }
        a = f_cap / cap_value;
        b = 0.0;
        flag = if flag == Flag::None { Flag::Clamped } else { Flag::Both };
    }

    if !(a > 0.0) {
        return Err(CalibrationError(format!("a must be positive, got {a}")));
    }
    Ok(Calibration {
        a,
        b: b.max(0.0),
        cap: cap.unwrap_or(f64::INFINITY),
        clamped,
        convex_flag: numeric_flag || structural_flag || clamped,
        flag,
        drift,
        eta,
        split_hint: drift.abs() > drift_tol,
        calib_delta: d_bar,
        tangent_delta,
        note,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cpmm(x0: f64, y0: f64, sizes: &[f64]) -> (Vec<f64>, Vec<f64>) {
        let q = sizes.iter().map(|&d| y0 * d / (x0 + d)).collect();
        (sizes.to_vec(), q)
    }

    #[test]
    fn a_cpmm_ladder_fits_a_positive_curvature() {
        let (x, y) = cpmm(1e6, 1e6, &[1.0, 1e2, 1e3, 1e4]);
        let got = calibrate(&x, &y, None, false, DRIFT_TOL, None, None, 0.0).unwrap();
        assert!(got.a > 0.0 && got.b > 0.0, "{got:?}");
        assert!(!got.clamped);
    }

    #[test]
    fn a_wall_becomes_a_finite_cap() {
        let x = vec![1.0, 10.0, 100.0, 1000.0];
        let y = vec![1.0, 10.0, 11.472806, 11.472806];
        let got = calibrate(&x, &y, None, false, DRIFT_TOL, None, None, 0.0).unwrap();
        assert!(got.clamped, "{got:?}");
        assert!(got.cap.is_finite(), "a clamped arc needs a finite cap");
        assert_eq!(got.b, 0.0);
    }

    #[test]
    fn duplicate_sizes_collapse_rather_than_reading_as_a_wall() {
        let x = vec![1.0, 1.0 + 1e-12, 100.0];
        let y = vec![1.0, 1.0, 99.0];
        let got = calibrate(&x, &y, None, false, DRIFT_TOL, None, None, 0.0).unwrap();
        assert!(!got.clamped, "the duplicate read as saturation: {got:?}");
    }

    #[test]
    fn a_short_ladder_is_refused() {
        assert!(calibrate(&[1.0], &[1.0], None, false, DRIFT_TOL, None, None, 0.0).is_err());
    }
}
