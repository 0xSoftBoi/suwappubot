//! Cholesky for the restricted Laplacian, with an LU fallback.
//!
//! `L = B^T diag(G) B` over the nodes reachable from `dst`, with `dst` itself
//! removed, is symmetric positive definite: the quadratic form is
//! `sum_p G_p (x_tau - x_sig)^2` over a connected set with one node grounded,
//! which is zero only at `x = 0`.  So Cholesky applies, and it is the right
//! factorisation twice over -- half the arithmetic of LU, no pivoting and no
//! row swaps, which is most of what makes a scalar LU slow at this size.
//!
//! It is also the more informative failure: a matrix that has lost positive
//! definiteness is a graph whose conditioning has gone wrong (§9.7), and
//! stopping there beats returning a plausible number.  The caller falls back to
//! LU rather than failing, because the graph deliberately tolerates
//! `MAX_CONDITION = 1e12` and near-singular is not the same as wrong.
//!
//! The factor is stored **transposed**: the array holds `U = L^T` in the upper
//! triangle, row-major.  That is not a detail -- it is what decides the speed.
//! Two of the four hot loops walk the factor by column, and with `L` stored
//! row-major those strides are `n` apart, so every access is its own cache
//! line.  Holding `U` instead turns all four into contiguous row walks: the
//! right-looking factorisation writes rows, the rank-1 update sweeps a row per
//! column of `L`, and the two substitutions take the axpy and dot forms
//! respectively.  Measured on a live quote, the back-substitution was running
//! at about a quarter of the arithmetic it should have been.

/// Factorise the symmetric `a` (row-major, `n x n`) in place, leaving `U = L^T`
/// in its upper triangle.  Returns false if a pivot is not positive -- the
/// caller should fall back.
///
/// Right-looking, so the trailing update reads two rows of `U` and writes a
/// row of the remaining matrix.  The classic left-looking form would read a
/// column per inner product instead.
pub fn factor(a: &mut [f64], n: usize) -> bool {
    for k in 0..n {
        let diag = a[k * n + k];
        if !(diag > 0.0) || !diag.is_finite() {
            return false;
        }
        let d = diag.sqrt();
        a[k * n + k] = d;
        let inv = 1.0 / d;
        for j in (k + 1)..n {
            a[k * n + j] *= inv;
        }
        // Trailing submatrix, upper triangle only.
        for i in (k + 1)..n {
            let u_ki = a[k * n + i];
            if u_ki == 0.0 {
                continue;
            }
            for j in i..n {
                a[i * n + j] -= u_ki * a[k * n + j];
            }
        }
    }
    true
}

/// Solve `L L^T x = b` in place, given `factor` has run and left `U = L^T`.
pub fn solve_factored(a: &[f64], b: &mut [f64], n: usize) {
    // Forward, `L y = b`, in axpy form: `L[i][k] = U[k][i]`, so eliminating
    // column `k` sweeps row `k` of `U`.
    for k in 0..n {
        let y = b[k] / a[k * n + k];
        b[k] = y;
        if y == 0.0 {
            continue;
        }
        for i in (k + 1)..n {
            b[i] -= a[k * n + i] * y;
        }
    }
    // Back, `U x = y`, in dot form: row `i` of `U`, contiguous.
    for i in (0..n).rev() {
        let mut sum = b[i];
        for j in (i + 1)..n {
            sum -= a[i * n + j] * b[j];
        }
        b[i] = sum / a[i * n + i];
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn solves_a_positive_definite_system() {
        // [[4, 1], [1, 3]] x = [1, 2]  ->  x = [1/11, 7/11]
        let mut a = vec![4.0, 1.0, 1.0, 3.0];
        let mut b = vec![1.0, 2.0];
        assert!(factor(&mut a, 2));
        solve_factored(&a, &mut b, 2);
        assert!((b[0] - 1.0 / 11.0).abs() < 1e-12);
        assert!((b[1] - 7.0 / 11.0).abs() < 1e-12);
    }

    #[test]
    fn refuses_a_matrix_that_is_not_positive_definite() {
        let mut a = vec![0.0, 1.0, 1.0, 0.0];
        assert!(!factor(&mut a, 2));
    }

    #[test]
    fn matches_lu_on_a_laplacian() {
        // Path graph 0-1-2 grounded at 2: L = [[1,-1],[-1,2]]
        let mut c = vec![1.0, -1.0, -1.0, 2.0];
        let mut bc = vec![0.5, -0.25];
        let mut l = c.clone();
        let mut bl = bc.clone();
        assert!(factor(&mut c, 2));
        solve_factored(&c, &mut bc, 2);
        crate::lu::solve_in_place(&mut l, &mut bl, 2).unwrap();
        for i in 0..2 {
            assert!((bc[i] - bl[i]).abs() < 1e-12, "chol {:?} lu {:?}", bc, bl);
        }
    }
}

/// Rank-1 update of `L L^T` to `L L^T + x x^T`, in place.  `x` is consumed.
///
/// This is why the port can beat LAPACK here rather than merely match it.
/// Refactorising is `O(n^3/6)`; a pivot changes one arc, which changes the
/// Laplacian by exactly `+/- G (e_a - e_b)(e_a - e_b)^T` -- a rank-1 term --
/// and updating the factor is `O(n^2)`.  At n = 300 that is fifty times less
/// arithmetic, and the kept-node set (which fixes the matrix dimension) was
/// measured to change **once per solve**, so essentially every pivot qualifies.
///
/// In Python this was the wrong trade and was measured as such: an `O(n^2)`
/// interpreter loop lost to numpy's blocked `O(n^3)`. In Rust the operation
/// count is what decides.
pub fn update(l: &mut [f64], n: usize, x: &mut [f64]) {
    for k in 0..n {
        let lkk = l[k * n + k];
        let xk = x[k];
        if xk == 0.0 {
            continue;
        }
        let r = (lkk * lkk + xk * xk).sqrt();
        let c = r / lkk;
        let s = xk / lkk;
        l[k * n + k] = r;
        for i in (k + 1)..n {
            let lik = (l[k * n + i] + s * x[i]) / c;
            x[i] = c * x[i] - s * lik;
            l[k * n + i] = lik;
        }
    }
}

/// Rank-1 downdate to `L L^T - x x^T`.  Returns false if the result would not
/// be positive definite, in which case `l` is left unusable and the caller must
/// refactorise -- removing an arc can genuinely disconnect the system, which is
/// not an error but is not a downdate either.
pub fn downdate(l: &mut [f64], n: usize, x: &mut [f64]) -> bool {
    for k in 0..n {
        let lkk = l[k * n + k];
        let xk = x[k];
        if xk == 0.0 {
            continue;
        }
        let inner = lkk * lkk - xk * xk;
        if !(inner > 0.0) || !inner.is_finite() {
            return false;
        }
        let r = inner.sqrt();
        let c = r / lkk;
        let s = xk / lkk;
        l[k * n + k] = r;
        for i in (k + 1)..n {
            let lik = (l[k * n + i] - s * x[i]) / c;
            x[i] = c * x[i] - s * lik;
            l[k * n + i] = lik;
        }
    }
    true
}

#[cfg(test)]
mod update_tests {
    use super::*;

    fn dense_from(l: &[f64], n: usize) -> Vec<f64> {
        let mut a = vec![0.0; n * n];
        for i in 0..n {
            for j in 0..n {
                let mut s = 0.0;
                for k in 0..=i.min(j) {
                    s += l[k * n + i] * l[k * n + j];
                }
                a[i * n + j] = s;
            }
        }
        a
    }

    #[test]
    fn an_update_matches_refactorising() {
        let n = 4;
        let base = vec![
            4.0, 1.0, 0.0, 0.5, 1.0, 3.0, 0.5, 0.0, 0.0, 0.5, 2.5, 0.25, 0.5, 0.0,
            0.25, 3.5,
        ];
        let x = vec![0.3, -0.7, 0.2, 0.9];
        let mut want = base.clone();
        for i in 0..n {
            for j in 0..n {
                want[i * n + j] += x[i] * x[j];
            }
        }
        assert!(factor(&mut want, n));
        let want_dense = dense_from(&want, n);

        let mut l = base.clone();
        assert!(factor(&mut l, n));
        let mut xs = x.clone();
        update(&mut l, n, &mut xs);
        let got = dense_from(&l, n);
        for i in 0..n * n {
            assert!((got[i] - want_dense[i]).abs() < 1e-10,
                    "entry {i}: {} vs {}", got[i], want_dense[i]);
        }
    }

    #[test]
    fn a_downdate_undoes_an_update() {
        let n = 3;
        let base = vec![4.0, 1.0, 0.5, 1.0, 3.0, 0.25, 0.5, 0.25, 2.0];
        let x = vec![0.2, 0.4, -0.1];
        let mut l = base.clone();
        assert!(factor(&mut l, n));
        let before = dense_from(&l, n);
        let mut up = x.clone();
        update(&mut l, n, &mut up);
        let mut down = x.clone();
        assert!(downdate(&mut l, n, &mut down));
        let after = dense_from(&l, n);
        for i in 0..n * n {
            assert!((before[i] - after[i]).abs() < 1e-9,
                    "entry {i}: {} vs {}", before[i], after[i]);
        }
    }

    #[test]
    fn a_downdate_that_would_break_definiteness_says_so() {
        let n = 2;
        let mut l = vec![1.0, 0.0, 0.0, 1.0];
        assert!(factor(&mut l, n));
        let mut x = vec![5.0, 0.0];   // far larger than the matrix
        assert!(!downdate(&mut l, n, &mut x));
    }
}
