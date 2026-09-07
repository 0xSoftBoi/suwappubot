//! Dense LU with partial pivoting, for the small symmetric systems the
//! active-set loop solves once per pivot.
//!
//! Not BLAS.  The measured median system is n = 49 (p90 85, max 121) over a
//! mainnet universe, and at that size the whole factorisation is ~80 kflop --
//! microseconds of arithmetic.  Binding a Fortran LAPACK would buy nothing and
//! cost a dependency with no wasm build, which is the one thing this crate
//! cannot have.
//!
//! The matrix is a graph Laplacian restricted to the component containing
//! `dst`, so it is symmetric positive definite and a Cholesky would do.  LU
//! with partial pivoting is used anyway: it is the same cost at this size, and
//! it does not fail on a matrix that conditioning has pushed slightly
//! indefinite -- which the graph deliberately tolerates up to `MAX_CONDITION`.

/// A system that cannot be solved: the factorisation hit a zero pivot.
#[derive(Debug)]
pub struct Singular {
    pub column: usize,
}

/// Solve `a x = b` in place.  `a` is row-major `n x n` and is consumed.
pub fn solve_in_place(a: &mut [f64], b: &mut [f64], n: usize) -> Result<(), Singular> {
    debug_assert_eq!(a.len(), n * n);
    debug_assert_eq!(b.len(), n);

    for col in 0..n {
        // Partial pivot: the largest magnitude at or below the diagonal.
        let mut best = col;
        let mut best_abs = a[col * n + col].abs();
        for row in (col + 1)..n {
            let v = a[row * n + col].abs();
            if v > best_abs {
                best = row;
                best_abs = v;
            }
        }
        if !(best_abs > 0.0) || !best_abs.is_finite() {
            return Err(Singular { column: col });
        }
        if best != col {
            for k in 0..n {
                a.swap(col * n + k, best * n + k);
            }
            b.swap(col, best);
        }

        let pivot = a[col * n + col];
        for row in (col + 1)..n {
            let factor = a[row * n + col] / pivot;
            if factor == 0.0 {
                continue;
            }
            a[row * n + col] = 0.0;
            for k in (col + 1)..n {
                a[row * n + k] -= factor * a[col * n + k];
            }
            b[row] -= factor * b[col];
        }
    }

    // Back substitution.
    for row in (0..n).rev() {
        let mut sum = b[row];
        for k in (row + 1)..n {
            sum -= a[row * n + k] * b[k];
        }
        let pivot = a[row * n + row];
        if pivot == 0.0 {
            return Err(Singular { column: row });
        }
        b[row] = sum / pivot;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn solves_a_known_system() {
        // [[4, 1], [1, 3]] x = [1, 2]  ->  x = [1/11, 7/11]
        let mut a = vec![4.0, 1.0, 1.0, 3.0];
        let mut b = vec![1.0, 2.0];
        solve_in_place(&mut a, &mut b, 2).unwrap();
        assert!((b[0] - 1.0 / 11.0).abs() < 1e-12);
        assert!((b[1] - 7.0 / 11.0).abs() < 1e-12);
    }

    #[test]
    fn pivots_when_the_diagonal_is_zero() {
        // Needs a row swap: without pivoting this divides by zero.
        let mut a = vec![0.0, 1.0, 1.0, 0.0];
        let mut b = vec![2.0, 3.0];
        solve_in_place(&mut a, &mut b, 2).unwrap();
        assert!((b[0] - 3.0).abs() < 1e-12);
        assert!((b[1] - 2.0).abs() < 1e-12);
    }

    #[test]
    fn refuses_a_singular_matrix() {
        let mut a = vec![1.0, 2.0, 2.0, 4.0];
        let mut b = vec![1.0, 2.0];
        assert!(solve_in_place(&mut a, &mut b, 2).is_err());
    }
}
