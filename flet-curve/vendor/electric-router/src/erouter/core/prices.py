"""Reference prices by weighted least squares on log-prices (spec §4).

`nu` defines both `G_p` and `eps_p`, and the best estimator is a weighted LS
fit -- itself one Laplacian solve, reusing the router's own machinery:

    min_z  sum_p w_p ( z_sig - z_tau + log a_p )^2      =>   L_w z = -M^T W log a

It fits the best *consistent* price system rather than trusting any single quote
path, and with `w_p = TVL_p` a single manipulated shallow pool cannot move the
frame.

**Feed both directions at half weight.**  For one pool the fit then lands at
`z_tau - z_sig = (log a_f - log a_r) / 2`, the fee-free mid exactly: the two
one-sided quotes bracket it by +/- log(Gamma).  Using one direction biases every
reference price to that side of the spread by the fee, systematically -- and a
mis-estimated `nu` can manufacture a negative 2-cycle that the solver will
happily route around (§2.6).
"""

from __future__ import annotations

import numpy as np

from .graph import component_of, laplacian
from .linalg import DEFAULT_SOLVER, SingularSystem

# A pool's two directions must agree on the price to within fees: `a_f * a_r` is
# `Gamma_live^2` (§2.6), just under 1 for any symmetric-fee CFMM.  Far below it
# means the two probes landed in different regimes and neither `a` is a marginal
# rate -- mainnet LLAMMA markets, banded and quoting from whichever band is live,
# measure 0.000616 and 0.002516 against 0.999+ for every ordinary pool.  Such an
# arc is still perfectly routable; it just must not vote on what anything is
# worth.
ROUND_TRIP_FLOOR = 0.5
# Muted, not removed: `reference_prices` requires strictly positive weights,
# and a vanishing one is the same thing numerically while keeping the arc in
# the system of equations that connects the graph.
MUTED_WEIGHT = 1e-12


def price_fit_weights(keys: list, a: np.ndarray, w: np.ndarray) -> np.ndarray:
    """Mute arcs whose own reverse direction contradicts them.

    §4 fits log-prices by weighted least squares, so one arc claiming WETH is
    worth 296 crvUSD drags the whole frame -- and the frame sets `eps` and `G`
    for *every* arc, not just the liar.  Adding 11 LLAMMA markets moved crvUSD
    36% and USDC 27% away from parity.

    `keys[k]` is `(pool, i, j)` and the partner is `(pool, j, i)`.  Pairing on
    node indices instead is wrong and quietly so: a dozen pools join USDC and
    USDT, so a healthy arc gets matched against some *other* pool's reverse and
    muted for its neighbour's sins.
    """
    w = np.array(w, dtype=float)
    forward = {
        key: a[k] for k, key in enumerate(keys) if a[k] > 0
    }
    for k, key in enumerate(keys):
        if a[k] <= 0:
            continue
        pool, i, j = key
        back = forward.get((pool, j, i))
        if back is not None and a[k] * back < ROUND_TRIP_FLOOR:
            w[k] = MUTED_WEIGHT
    return w


def reference_prices(
    tau: np.ndarray,
    sig: np.ndarray,
    a: np.ndarray,
    w: np.ndarray,
    n_nodes: int,
    numeraire: int,
    *,
    solver=None,
) -> np.ndarray:
    """Fit `nu` with `nu[numeraire] == 1`.

    `a` must be strictly positive.  A zero marginal rate is not a cheap pool but
    a broken probe: `log 0` would NaN the whole reference frame, and 6% of arcs
    fail their smallest probe on mainnet.
    """
    tau = np.asarray(tau, np.int64)
    sig = np.asarray(sig, np.int64)
    a = np.asarray(a, float)
    w = np.asarray(w, float)
    solver = solver or DEFAULT_SOLVER

    if a.size and not np.all(a > 0):
        bad = int(np.argmin(a))
        raise ValueError(
            f"arc {bad} has a={a[bad]!r}; reference prices need a > 0 "
            "(a failed probe must drop the arc, not enter the fit as zero)"
        )
    if w.size and not np.all(w > 0):
        raise ValueError("reference-price weights must be positive")

    z = np.zeros(n_nodes)
    if tau.size == 0:
        return np.ones(n_nodes)

    # Only the numeraire's component is determined; anything disconnected keeps
    # nu = 1 and will be dropped later for want of a route.
    comp = component_of(numeraire, tau, sig, n_nodes)
    keep = np.flatnonzero(comp & (np.arange(n_nodes) != numeraire))
    if keep.size:
        log_a = np.log(a)
        rhs = np.zeros(n_nodes)
        np.subtract.at(rhs, sig, w * log_a)
        np.add.at(rhs, tau, w * log_a)
        L = laplacian(tau, sig, w, n_nodes, keep)
        try:
            z[keep] = solver.solve(L, rhs[keep])
        except SingularSystem as exc:  # pragma: no cover - guarded by `comp`
            raise SingularSystem(f"reference-price fit is singular: {exc}") from exc
    return np.exp(z)


def dislocations(
    tau: np.ndarray, sig: np.ndarray, a: np.ndarray, nu: np.ndarray
) -> np.ndarray:
    """Residuals `r_p = z_sig - z_tau + log a_p`.

    Large |r_p| flags a stale pool or a genuine arbitrage, so these are worth
    surfacing rather than discarding.
    """
    return np.log(nu[sig]) - np.log(nu[tau]) + np.log(a)


def pool_mid(a_forward: float, a_reverse: float) -> float:
    """Fee-free mid price implied by the two one-sided quotes."""
    return float(np.sqrt(a_forward / a_reverse))


def gamma_live(a_forward: float | np.ndarray, a_reverse: float | np.ndarray):
    """Measured effective retention, `sqrt(a_f * a_r)` (§2.6).

    Reads the pool's *current* fee off two tiny probes -- no fee parameters, no
    ABI knowledge of the fee law.  For a fixed-fee pool it must equal `1 - fee`
    to full precision, so a deviation means the probe pipeline is broken; for a
    dynamic-fee pool it is the live value and its drift is observable.
    """
    return np.sqrt(np.asarray(a_forward) * np.asarray(a_reverse))


def check_pair_drops(
    eps_forward: np.ndarray, eps_reverse: np.ndarray, tol: float = 0.0
) -> np.ndarray:
    """Indices where `eps_f + eps_r <= tol` -- a spurious negative 2-cycle.

    Round-tripping a pool always loses (`a_f a_r = Gamma^2 < 1`), but the
    *linearised* drops are frame-dependent and their sum falls below zero when
    `nu` is far enough off for that pair.  Violation means `nu` is inconsistent
    with the pool, not that arbitrage exists: snap `nu_sig/nu_tau` toward the
    pool's own mid, or drop the pool.
    """
    return np.flatnonzero(np.asarray(eps_forward) + np.asarray(eps_reverse) <= tol)
