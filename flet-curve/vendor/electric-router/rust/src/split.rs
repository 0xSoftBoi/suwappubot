//! The split search (§6.4): coordinate ascent over how a route divides.
//!
//! A port of the inner loop in `core/split.py`, which stays the reference.
//! The search calls `evaluate` ~100,000 times on a wide route and every one of
//! those is the same three steps -- project the weights, walk the legs
//! sequentially, read the destination balance -- over *sampled* curves.
//!
//! That is what makes it portable at all: nothing in here quotes a pool.  The
//! ladders are built in Python, where the client lives; by the time the search
//! runs, a leg is a pair of arrays and the whole thing is arithmetic.
//!
//! It is also why porting the pieces separately would not have helped.  A
//! curve evaluation is 0.7 us and a crossing is ~2 us, so moving `at` alone
//! would have lost; the loop had to come with it.

/// One leg's output as a function of its input, through sampled points.
///
/// `u = x / f(x)` on the probe sizes, interpolated linearly; `rate0` closes
/// the gap below the first probe and `tail` extrapolates past the last.
pub struct Curve {
    pub x: Vec<f64>,
    pub u: Vec<f64>,
    pub slope: Vec<f64>,
    pub rate0: f64,
    pub tail: f64,
}

impl Curve {
    #[inline]
    pub fn at(&self, v: f64) -> f64 {
        if v <= 0.0 {
            return 0.0;
        }
        let x = &self.x;
        if v <= x[0] {
            return v * self.rate0;
        }
        let inverse = if v >= x[x.len() - 1] {
            self.u[self.u.len() - 1] + (v - x[x.len() - 1]) * self.tail
        } else {
            // `bisect_right(x, v) - 1`, and the branch above has ruled out
            // both ends, so the index is in range.
            let k = match x.binary_search_by(|p| p.partial_cmp(&v).unwrap()) {
                // An exact hit: `bisect_right` returns the slot *after* the
                // last equal element, so walk forward over any duplicates.
                Ok(mut hit) => {
                    while hit + 1 < x.len() && x[hit + 1] <= v {
                        hit += 1;
                    }
                    hit
                }
                Err(insert) => insert - 1,
            };
            self.u[k] + (v - x[k]) * self.slope[k]
        };
        if inverse > 0.0 {
            v / inverse
        } else {
            0.0
        }
    }
}

/// Everything the walk needs that does not change between evaluations.
pub struct Plan {
    pub curves: Vec<Curve>,
    pub src_of: Vec<usize>,
    pub dst_of: Vec<usize>,
    /// `None` for a leg whose share the search controls.
    pub static_share: Vec<Option<f64>>,
    pub heads: Vec<Vec<usize>>,
    pub tails: Vec<usize>,
    pub slots: usize,
    pub dst_slot: usize,
    pub amount_in: f64,
    pub min_weight: f64,
}

impl Plan {
    /// `walk(_fractions(weights))`: what the route delivers at this split.
    pub fn evaluate(&self, weights: &[Vec<f64>], fractions: &mut [Option<f64>],
                    balances: &mut [f64]) -> f64 {
        fractions.copy_from_slice(&self.static_share);
        for (g, head) in self.heads.iter().enumerate() {
            let w = &weights[g];
            // `_project`, unrolled: clip up to MIN_WEIGHT, then normalise.
            let mut total = 0.0;
            for &value in w.iter() {
                total += if value > self.min_weight { value } else { self.min_weight };
            }
            if total > 0.0 {
                let scale = 1.0 / total;
                for (slot, &index) in head.iter().enumerate() {
                    let one = if w[slot] > self.min_weight { w[slot] } else { self.min_weight };
                    fractions[index] = Some(one * scale);
                }
            } else {
                let share = 1.0 / w.len() as f64;
                for &index in head.iter() {
                    fractions[index] = Some(share);
                }
            }
            fractions[self.tails[g]] = None;
        }

        balances.iter_mut().for_each(|v| *v = 0.0);
        balances[0] = self.amount_in;
        let mut current = usize::MAX;
        let mut base = 0.0;
        for k in 0..self.src_of.len() {
            let source = self.src_of[k];
            if source != current {
                current = source;
                base = balances[source];
            }
            let available = balances[source];
            let take = match fractions[k] {
                None => available,
                Some(share) => (base * share).min(available),
            };
            if take <= 0.0 {
                continue;
            }
            balances[source] = available - take;
            balances[self.dst_of[k]] += self.curves[k].at(take);
        }
        balances[self.dst_slot]
    }
}

const GOLDEN: f64 = 0.618_033_988_749_894_8;   // (sqrt(5) - 1) / 2

/// Maximise a unimodal `objective` on `[lo, hi]` without derivatives.
fn golden<F: FnMut(f64) -> f64>(mut objective: F, lo: f64, hi: f64, iters: usize) -> f64 {
    let (mut a, mut b) = (lo, hi);
    let mut c = b - GOLDEN * (b - a);
    let mut d = a + GOLDEN * (b - a);
    let (mut fc, mut fd) = (objective(c), objective(d));
    for _ in 0..iters {
        if fc < fd {
            a = c;
            c = d;
            fc = fd;
            d = a + GOLDEN * (b - a);
            fd = objective(d);
        } else {
            b = d;
            d = c;
            fd = fc;
            c = b - GOLDEN * (b - a);
            fc = objective(c);
        }
    }
    0.5 * (a + b)
}

pub struct Ascent {
    pub weights: Vec<Vec<f64>>,
    pub best: f64,
    pub evaluations: usize,
}

/// Coordinate ascent, each coordinate maximised exactly by golden section.
#[allow(clippy::too_many_arguments)]
pub fn ascend(
    plan: &Plan,
    start: &[Vec<f64>],
    free: &[(usize, usize)],
    iters: usize,
    sweeps: usize,
    window: f64,
    sweep_tol: f64,
) -> Ascent {
    let m = plan.src_of.len();
    let mut fractions = vec![None; m];
    let mut balances = vec![0.0; plan.slots];
    let mut evaluations = 0usize;

    let mut weights: Vec<Vec<f64>> = start.to_vec();
    let mut best = plan.evaluate(&weights, &mut fractions, &mut balances);

    for _ in 0..sweeps {
        let opened = best;
        for &(g, j) in free {
            let row = &weights[g];
            let others: f64 = row[..row.len() - 1].iter().sum::<f64>() - row[j];
            let mut room = 1.0 - plan.min_weight - others;
            if room <= plan.min_weight {
                continue;
            }
            let mut low = plan.min_weight;
            if window > 0.0 {
                let here = weights[g][j];
                low = low.max(here - window);
                room = room.min(here + window);
                if room <= low {
                    continue;
                }
            }

            // Only group `g` changes, so the others are shared rather than
            // copied -- this runs once per golden-section probe.
            let mut trial: Vec<Vec<f64>> = weights.clone();
            let where_ = {
                let plan_ref = &plan;
                let weights_ref = &weights;
                let trial_ref = &mut trial;
                let frac = &mut fractions;
                let bal = &mut balances;
                let ev = &mut evaluations;
                golden(
                    |value| {
                        *ev += 1;
                        let mut row = weights_ref[g].clone();
                        row[j] = value;
                        let last = row.len() - 1;
                        let rest: f64 = row[..last].iter().sum();
                        row[last] = plan_ref.min_weight.max(1.0 - rest);
                        trial_ref[g] = row;
                        plan_ref.evaluate(trial_ref, frac, bal)
                    },
                    low,
                    room,
                    iters,
                )
            };

            let mut candidate: Vec<Vec<f64>> = weights.clone();
            candidate[g][j] = where_;
            let last = candidate[g].len() - 1;
            let rest: f64 = candidate[g][..last].iter().sum();
            candidate[g][last] = plan.min_weight.max(1.0 - rest);
            let value = plan.evaluate(&candidate, &mut fractions, &mut balances);
            if value > best {
                best = value;
                weights = candidate;
            }
        }
        if best <= opened * (1.0 + sweep_tol) {
            break;
        }
    }
    Ascent { weights, best, evaluations }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn linear(rate: f64) -> Curve {
        // f(x) = rate * x exactly, so u = 1 / rate everywhere.
        Curve { x: vec![1.0, 10.0, 100.0], u: vec![1.0 / rate; 3],
                slope: vec![0.0, 0.0], rate0: rate, tail: 0.0 }
    }

    #[test]
    fn a_linear_curve_is_its_rate() {
        let c = linear(2.0);
        assert!((c.at(5.0) - 10.0).abs() < 1e-12);
        assert!((c.at(0.5) - 1.0).abs() < 1e-12, "below the first probe");
        assert_eq!(c.at(0.0), 0.0);
    }

    #[test]
    fn a_concave_curve_pays_less_per_unit_as_it_grows() {
        let c = Curve { x: vec![1.0, 10.0], u: vec![1.0, 1.5],
                        slope: vec![(1.5 - 1.0) / 9.0], rate0: 1.0, tail: 0.05 };
        assert!(c.at(10.0) / 10.0 < c.at(1.0) / 1.0);
    }

    fn two_lane_plan(rate_a: f64, rate_b: f64) -> Plan {
        Plan {
            curves: vec![linear(rate_a), linear(rate_b)],
            src_of: vec![0, 0],
            dst_of: vec![1, 1],
            static_share: vec![None, None],
            heads: vec![vec![0]],
            tails: vec![1],
            slots: 2,
            dst_slot: 1,
            amount_in: 10.0,
            min_weight: 1e-4,
        }
    }

    #[test]
    fn everything_goes_down_the_better_lane_when_both_are_linear() {
        let plan = two_lane_plan(2.0, 1.0);
        let got = ascend(&plan, &[vec![0.5, 0.5]], &[(0, 0)], 20, 12, 0.0, 1e-9);
        assert!(got.weights[0][0] > 0.99, "{:?}", got.weights);
        assert!((got.best - 20.0).abs() < 1e-2);
    }

    #[test]
    fn a_split_beats_either_lane_when_both_are_concave() {
        // Two identical concave lanes: half each must beat all of one.
        let c = || Curve { x: vec![1.0, 100.0], u: vec![1.0, 3.0],
                           slope: vec![(3.0 - 1.0) / 99.0], rate0: 1.0, tail: 0.02 };
        let plan = Plan {
            curves: vec![c(), c()], src_of: vec![0, 0], dst_of: vec![1, 1],
            static_share: vec![None, None], heads: vec![vec![0]], tails: vec![1],
            slots: 2, dst_slot: 1, amount_in: 100.0, min_weight: 1e-4,
        };
        // A row carries one weight per leg in the group, the last being the
        // tail's share -- so a two-leg group is two entries, not one.
        let mut frac = vec![None; 2];
        let mut bal = vec![0.0; 2];
        let all_one = plan.evaluate(&[vec![1.0 - 1e-4, 1e-4]], &mut frac, &mut bal);
        let got = ascend(&plan, &[vec![0.5, 0.5]], &[(0, 0)], 20, 12, 0.0, 1e-9);
        assert!(got.best > all_one, "{} vs {}", got.best, all_one);
        assert!((got.weights[0][0] - 0.5).abs() < 0.05, "{:?}", got.weights);
    }
}
