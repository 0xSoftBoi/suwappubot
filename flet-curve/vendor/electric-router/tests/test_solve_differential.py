"""Spec §13.3: the active-set solve against an independent QP solver.

Every other test here checks the solver against its own reasoning -- the same
active-set machinery that produced the answer, or an invariant the code was
written to satisfy.  This one poses `(P)` to OSQP, which shares no code with
`core/solve.py`, and compares the objective.

    minimise   sum_p [ eps_p psi_p + psi_p^2 / (2 G_p) ]
    subject to B^T psi = s_hat,  0 <= psi <= cap

That makes it the oracle a *port* has to be checked against: validating a rewrite
by "does it match the Python" reproduces the Python's bugs faithfully.

The comparison is on the **objective**, not on `psi`.  Two flows can tie exactly
-- parallel arcs with equal `eps` and `G` split arbitrarily -- so comparing
arc-by-arc would fail where both answers are right.  Where the optimum is unique
the flows are compared too.
"""

from __future__ import annotations

import numpy as np
import pytest

from erouter.core import graph
from erouter.core.solve import active_set_solve

osqp = pytest.importorskip("osqp")
sparse = pytest.importorskip("scipy.sparse")


def make(tau, sig, a, B, *, cap=None, Psi=1.0, n=None):
    tau = np.asarray(tau, np.int64)
    sig = np.asarray(sig, np.int64)
    n = n or int(max(tau.max(), sig.max()) + 1)
    return graph.build(tau, sig, np.asarray(a, float), np.asarray(B, float),
                       np.ones(n), Psi, cap=cap, n_nodes=n,
                       merge_duplicates=False)


def objective(g, psi):
    """`sum eps psi + psi^2 / 2G`, the program's own value."""
    quad = np.where(g.G > 0, psi**2 / (2 * g.G), 0.0)
    return float(np.sum(g.eps * psi) + np.sum(quad))


def reference(g, src, dst, Psi):
    """Solve `(P)` with OSQP.  Returns (objective, psi)."""
    m, n = len(g.tau), g.n_nodes
    # B^T: one row per node, +1 where the arc arrives, -1 where it leaves.
    rows, cols, vals = [], [], []
    for p in range(m):
        rows.append(int(g.tau[p]))
        cols.append(p)
        vals.append(1.0)
        rows.append(int(g.sig[p]))
        cols.append(p)
        vals.append(-1.0)
    incidence = sparse.csc_matrix((vals, (rows, cols)), shape=(n, m))
    s_hat = np.zeros(n)
    s_hat[src] += Psi
    s_hat[dst] -= Psi

    upper = np.where(np.isfinite(g.cap), g.cap, 1e12 * max(Psi, 1.0))
    A = sparse.vstack([incidence, sparse.eye(m, format="csc")], format="csc")
    lo = np.concatenate([s_hat, np.zeros(m)])
    hi = np.concatenate([s_hat, upper])
    # The quadratic term is `psi^2 / (2 G)`, so `P = diag(1/G)` given OSQP's
    # own factor of a half.  An arc with `G = inf` (a clamped, linear element)
    # contributes nothing.
    inv = np.where(g.G > 0, 1.0 / np.where(np.isfinite(g.G), g.G, np.inf), 0.0)
    P = sparse.diags(np.nan_to_num(inv, posinf=0.0), format="csc")

    prob = osqp.OSQP()
    prob.setup(P=P, q=g.eps.astype(float), A=A, l=lo, u=hi, verbose=False,
               eps_abs=1e-10, eps_rel=1e-10, max_iter=200_000, polishing=True)
    res = prob.solve()
    status = getattr(res.info, "status", "")
    if "solved" not in str(status):
        pytest.skip(f"OSQP did not converge: {status}")
    psi = np.clip(np.asarray(res.x, float), 0.0, None)
    return objective(g, psi), psi


# `tau` is an arc's origin and `sig` its head, which is the orientation the
# rest of the tests use and the one that makes `s_hat[src] = +Psi` come out.
CASES = {
    # A single pool: the answer is forced, so any disagreement is a units bug.
    "one arc": {"tau": [0], "sig": [1], "a": [1.0], "B": [1.0], "Psi": 0.25},
    # Two lanes of different depth: the split is the whole question.
    "parallel": {"tau": [0, 0], "sig": [1, 1], "a": [1.0, 1.0], "B": [1.0, 2.0], "Psi": 1.0},
    # Unequal `a`: the diode decides whether the dearer lane opens at all.
    "diode": {"tau": [0, 0], "sig": [1, 1], "a": [1.0, 0.9999], "B": [1.0, 1.0], "Psi": 0.5},
    # Two hops against one: 0->1->2 versus 0->2 direct.
    "series": {"tau": [0, 0, 1], "sig": [2, 1, 2], "a": [0.997, 0.9995, 0.9995],
                   "B": [1.0, 1.0, 1.0], "Psi": 0.4},
    # A capped lane: the bound has to bind in both solvers.
    "capped": {"tau": [0, 0], "sig": [1, 1], "a": [1.0, 0.999], "B": [1.0, 1.0],
                   "cap": [0.2, np.inf], "Psi": 1.0},
    # Five arcs over four nodes, the shape a real split takes.
    "network": {"tau": [0, 0, 1, 2, 0], "sig": [1, 2, 3, 3, 3],
                    "a": [0.9995, 0.9990, 0.9995, 0.9998, 0.996],
                    "B": [1.0, 2.0, 1.0, 3.0, 0.5], "Psi": 2.0},
}


@pytest.mark.parametrize("name", list(CASES))
def test_the_objective_matches_an_independent_solver(name):
    spec = dict(CASES[name])
    Psi = spec.pop("Psi")
    g = make(Psi=Psi, **spec)
    dst = int(max(g.tau.max(), g.sig.max()))

    ours = active_set_solve(g, 0, dst, Psi)
    assert ours.feasible, f"{name}: our solve refused a problem OSQP accepts"
    mine = ours.objective(g)
    theirs, _ = reference(g, 0, dst, Psi)

    # Relative to the trade, because the objective is a loss in value terms.
    assert mine <= theirs + 1e-9 * Psi, (
        f"{name}: OSQP found a better flow -- ours {mine:.12g}, "
        f"OSQP {theirs:.12g}, worse by {(mine - theirs) / Psi * 1e4:.6f} bp"
    )
    assert abs(mine - theirs) <= 1e-9 * Psi, (
        f"{name}: objectives disagree by {(mine - theirs) / Psi * 1e4:.6f} bp"
    )


@pytest.mark.parametrize("name", ["one arc", "series", "capped"])
def test_the_flow_matches_where_the_optimum_is_unique(name):
    """Where no two arcs are interchangeable, the arcs themselves must agree."""
    spec = dict(CASES[name])
    Psi = spec.pop("Psi")
    g = make(Psi=Psi, **spec)
    dst = int(max(g.tau.max(), g.sig.max()))

    ours = active_set_solve(g, 0, dst, Psi)
    _, theirs = reference(g, 0, dst, Psi)
    assert np.allclose(ours.psi, theirs, atol=1e-6 * Psi), (
        f"{name}: flows differ by {np.max(np.abs(ours.psi - theirs)) / Psi:.3e} of Psi"
    )
