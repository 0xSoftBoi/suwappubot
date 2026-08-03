#!/usr/bin/env python3
"""Adversarial verification of the contest equilibrium solver.

Checks that exact_equilibrium() returns a genuine Nash equilibrium:
  A. first-order conditions hold for every active player
  B. every inactive player's marginal payoff at e=0 is non-positive
  C. brute-force: no unilateral deviation on a fine grid improves any player's payoff
  D. independent damped best-response dynamics converge to the same aggregate
"""
import numpy as np
from tullock_sim import exact_equilibrium

RNG = np.random.default_rng(7)
V = 1_000_000.0


def payoff(e_i, S_minus, c_i, V):
    S = e_i + S_minus
    return (V * e_i / S if S > 0 else 0.0) - c_i * e_i


def br_dynamics(costs, V, iters=200_000, damp=0.02):
    """Independent check: heavily damped simultaneous best response."""
    costs = np.asarray(costs, float)
    e = np.full(len(costs), V / (costs.mean() * len(costs)))
    for _ in range(iters):
        S_minus = e.sum() - e
        cand = np.maximum(np.sqrt(np.maximum(V * S_minus / costs, 0)) - S_minus, 0.0)
        e = (1 - damp) * e + damp * cand
    return e


def check(costs, label):
    e, S, spend, D = exact_equilibrium(costs, V)
    costs = np.asarray(costs, float)
    active = e > 1e-9

    # A. FOC residual for active players: V (S - e_i) / S^2 - c_i == 0
    foc = V * (S - e[active]) / S**2 - costs[active]
    foc_max = np.max(np.abs(foc)) if active.any() else 0.0

    # B. inactive players must not want to enter: V/S - c_i <= 0
    viol_b = 0
    if (~active).any():
        marg = V / S - costs[~active]
        viol_b = int((marg > 1e-9).sum())

    # C. brute force deviations on a grid, for a sample of players
    worst_gain = 0.0
    idx_sample = list(np.where(active)[0][:5]) + list(np.where(~active)[0][:5])
    for i in idx_sample:
        S_minus = S - e[i]
        base = payoff(e[i], S_minus, costs[i], V)
        grid = np.concatenate([np.linspace(0, max(e[i] * 3, S * 0.5), 4000)])
        best = max(payoff(g, S_minus, costs[i], V) for g in grid)
        worst_gain = max(worst_gain, (best - base) / V)

    # D. independent dynamics
    e2 = br_dynamics(costs, V)
    S2 = e2.sum()
    agg_rel_err = abs(S2 - S) / S
    active2 = int((e2 > S2 * 1e-6).sum())

    print(f"{label}")
    print(f"  active={int(active.sum())}  S={S:,.0f}  dissipation={D:.4f}")
    print(f"  A. max |FOC residual| (active)      = {foc_max:.3e}   {'OK' if foc_max < 1e-6 else 'FAIL'}")
    print(f"  B. inactive players wanting entry   = {viol_b}          {'OK' if viol_b == 0 else 'FAIL'}")
    print(f"  C. best grid deviation gain (/V)    = {worst_gain:.3e}   {'OK' if worst_gain < 1e-6 else 'FAIL'}")
    print(f"  D. indep. dynamics aggregate rel.err= {agg_rel_err:.3e} (active~{active2})"
          f"   {'OK' if agg_rel_err < 5e-3 else 'CHECK'}")
    return D, int(active.sum())


print("=== symmetric (sanity: theory says D=(n-1)/n) ===")
for n in (2, 10, 100):
    D, a = check(np.ones(n), f"n={n} symmetric   [theory D={(n-1)/n:.4f}]")

print("\n=== heterogeneous lognormal costs ===")
for n in (10, 200, 1000):
    for sigma in (0.3, 0.6):
        c = np.exp(RNG.normal(0, sigma, n)); c /= c.mean()
        check(c, f"n={n} sigma={sigma}")

print("\n=== how many farmers actually capture the pool? ===")
for sigma in (0.2, 0.4, 0.6, 1.0):
    c = np.exp(RNG.normal(0, sigma, 5000)); c /= c.mean()
    e, S, spend, D = exact_equilibrium(c, V)
    act = e > 1e-9
    profit = V * e[act] / S - c[act] * e[act]
    print(f"  sigma={sigma}: active={int(act.sum()):3d}/5000  dissipation={D:.4f}  "
          f"farmer surplus={profit.sum()/V:.4f} of pool  "
          f"top-1 share of pool={float((V*e[act]/S).max()/V):.3f}")
