"""Dense linear solves for the graph Laplacian.

Measured at the sizes this router actually runs at (single-threaded, us/solve):

    n=299, 900 arcs   dense LU 2125   dense Cholesky 2516   scipy splu 6272
    n=10              dense LU   53   dense Cholesky   64   scipy splu   78

Three things follow, none of which match the textbook:

* Dense LU beats dense Cholesky by 15-25%: LAPACK's blocked `getrf` wins at this
  size and the n^3/3 flop advantage does not show up until much larger n.
* Sparse is 3x *slower* at n~300 -- per-call symbolic analysis dominates.
* The per-pivot system is tiny anyway (the active set is 3-10 arcs), where
  everything is call overhead.

So: dense, refactorise every pivot -- ~2.5 ms against a ~7 s cold route, 0.03%.
Sparse Cholesky with rank-1 updates is a real optimisation at n~1e5, not here,
and this interface keeps it a drop-in.

Cholesky is kept as a debug mode: it raises on an indefinite matrix where LU
silently returns a plausible answer.  That is a weak net -- a single negative
conductance at 10% of max(G) leaves the Laplacian positive definite and both
succeed -- which is why `G > 0` is enforced at the source instead.
"""

from __future__ import annotations

import numpy as np


class SingularSystem(RuntimeError):
    """The Laplacian is not invertible: usually a disconnected node (§9.4)."""


class DenseLU:
    """Default.  Raises only on exact singularity."""

    name = "lu"

    def solve(self, matrix: np.ndarray, rhs: np.ndarray) -> np.ndarray:
        try:
            return np.linalg.solve(matrix, rhs)
        except np.linalg.LinAlgError as exc:
            raise SingularSystem(str(exc)) from exc


class DenseCholesky:
    """Debug mode.  Also raises when the matrix loses positive definiteness."""

    name = "cholesky"

    def solve(self, matrix: np.ndarray, rhs: np.ndarray) -> np.ndarray:
        try:
            factor = np.linalg.cholesky(matrix)
        except np.linalg.LinAlgError as exc:
            raise SingularSystem(f"not positive definite: {exc}") from exc
        y = np.linalg.solve(factor, rhs)
        return np.linalg.solve(factor.T, y)


DEFAULT_SOLVER = DenseLU()


def get_solver(name: str | None = None):
    if name in (None, "lu"):
        return DenseLU()
    if name == "cholesky":
        return DenseCholesky()
    raise ValueError(f"unknown linear solver {name!r}")
