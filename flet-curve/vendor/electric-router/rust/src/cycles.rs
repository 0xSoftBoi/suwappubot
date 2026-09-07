//! Circulation removal (§5.6).
//!
//! A cycle appears when the model believes some loop has negative total `eps`.
//! The solve is right to absorb it, but a router cannot *execute* a
//! circulation as part of a one-way trade, so it comes out before the route is
//! realised.
//!
//! Ported from `core/realize.py`, which stays the reference.  The peeling and
//! the tie-breaks are reproduced exactly rather than merely finding *a* cycle:
//! which cycle is found decides which arcs are cancelled, and two different
//! answers are two different routes.
//!
//! The Python runs `np.isin` inside the peeling loop, which is 257 us a call
//! and 3.4 ms for a full cancellation -- the largest single item left in a warm
//! quote once the solve, the fit and the search were compiled.

/// One directed cycle as arc indices, or `None`.
///
/// Peel arcs that cannot be on a cycle -- those whose head has no way out, or
/// whose tail has no way in -- until the set is stable.  Whatever survives has
/// every node with both an in- and an out-arc, so following out-edges must
/// revisit a node, and the revisit closes a cycle.
pub fn find_cycle(tau: &[i64], sig: &[i64], n_nodes: usize) -> Option<Vec<usize>> {
    let m = tau.len();
    if m == 0 {
        return None;
    }
    let mut alive = vec![true; m];
    let mut heads = vec![false; n_nodes];
    let mut tails = vec![false; n_nodes];

    loop {
        let mut any_alive = false;
        heads.iter_mut().for_each(|v| *v = false);
        tails.iter_mut().for_each(|v| *v = false);
        for k in 0..m {
            if alive[k] {
                any_alive = true;
                heads[tau[k] as usize] = true;   // nodes with a way out
                tails[sig[k] as usize] = true;   // nodes with a way in
            }
        }
        if !any_alive {
            return None;
        }
        let mut doomed = false;
        for k in 0..m {
            if alive[k] && (!heads[sig[k] as usize] || !tails[tau[k] as usize]) {
                alive[k] = false;
                doomed = true;
            }
        }
        if !doomed {
            break;
        }
    }

    let first = alive.iter().position(|&v| v)?;
    // `setdefault` keeps the lowest arc index per node, and the walk starts at
    // the tail of the lowest surviving arc.  Both are load-bearing: they pick
    // which cycle out of several this returns.
    let mut outgoing = vec![usize::MAX; n_nodes];
    for k in 0..m {
        if alive[k] {
            let t = tau[k] as usize;
            if outgoing[t] == usize::MAX {
                outgoing[t] = k;
            }
        }
    }

    let mut node = tau[first] as usize;
    let mut position = vec![usize::MAX; n_nodes];
    let mut path: Vec<usize> = Vec::new();
    while position[node] == usize::MAX {
        position[node] = path.len();
        let arc = outgoing[node];
        if arc == usize::MAX {
            return None;
        }
        path.push(arc);
        node = sig[arc] as usize;
    }
    Some(path[position[node]..].to_vec())
}

/// Remove circulation from a flow, leaving the same net delivery.
///
/// Returns the acyclic flow and how many cycles came out.
pub fn cancel_cycles(
    tau: &[i64], sig: &[i64], psi: &[f64], tol: f64, n_nodes: usize,
) -> (Vec<f64>, usize) {
    let mut flow = psi.to_vec();
    let mut removed = 0usize;
    for _ in 0..(flow.len() + 1) {
        let live: Vec<usize> = (0..flow.len()).filter(|&k| flow[k] > tol).collect();
        if live.is_empty() {
            break;
        }
        let sub_tau: Vec<i64> = live.iter().map(|&k| tau[k]).collect();
        let sub_sig: Vec<i64> = live.iter().map(|&k| sig[k]).collect();
        let cycle = match find_cycle(&sub_tau, &sub_sig, n_nodes) {
            Some(c) => c,
            None => break,
        };
        let arcs: Vec<usize> = cycle.iter().map(|&c| live[c]).collect();
        let least = arcs.iter().map(|&a| flow[a]).fold(f64::INFINITY, f64::min);
        for &a in &arcs {
            flow[a] -= least;
        }
        // Only the cycle's own arcs.  Zeroing everything at or below `tol`
        // would catch negative entries too, and a negative flow is real flow
        // in the reverse direction, not dust -- stranding it breaks
        // conservation after the solve has already finished.
        for &a in &arcs {
            if flow[a] <= tol {
                flow[a] = 0.0;
            }
        }
        removed += 1;
    }
    (flow, removed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_path_has_no_cycle() {
        assert!(find_cycle(&[0, 1], &[1, 2], 3).is_none());
    }

    #[test]
    fn a_two_cycle_is_found() {
        let got = find_cycle(&[0, 1], &[1, 0], 2).unwrap();
        assert_eq!(got.len(), 2);
    }

    #[test]
    fn a_cycle_hanging_off_a_path_is_found_without_the_path() {
        // 0 -> 1, then 1 -> 2 -> 1 loops.
        let got = find_cycle(&[0, 1, 2], &[1, 2, 1], 3).unwrap();
        assert_eq!(got, vec![1, 2], "the tail arc is not on the cycle");
    }

    #[test]
    fn cancelling_leaves_the_net_delivery() {
        // 0->1 carries 2, and 1->2->1 circulates 1.
        let tau = [0i64, 1, 2];
        let sig = [1i64, 2, 1];
        let (flow, n) = cancel_cycles(&tau, &sig, &[2.0, 1.0, 1.0], 1e-12, 3);
        assert_eq!(n, 1);
        assert_eq!(flow[0], 2.0, "the delivery is untouched");
        assert_eq!(flow[1], 0.0);
        assert_eq!(flow[2], 0.0);
    }

    #[test]
    fn a_negative_flow_is_not_dust() {
        // The reverse-direction arc is left alone rather than zeroed.
        let tau = [0i64, 1];
        let sig = [1i64, 2];
        let (flow, n) = cancel_cycles(&tau, &sig, &[1.0, -0.13], 1e-12, 3);
        assert_eq!(n, 0);
        assert_eq!(flow[1], -0.13, "reverse flow was stranded");
    }
}
