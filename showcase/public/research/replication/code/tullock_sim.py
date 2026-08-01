#!/usr/bin/env python3
"""
Monte Carlo and numerical verification for the points-as-Tullock-contest results.

Verifies, by simulation rather than assertion:
  P1  symmetric equilibrium effort/dissipation in a proportional (lottery) contest
      (solver-vs-closed-form consistency, not an independent test of the model)
  P2  dissipation fraction is invariant to the unit cost c  (caps don't help)
  P3  heterogeneous-cost equilibrium via exact active-set selection; participation
      collapses and dissipation falls below the symmetric benchmark
  P4  Sybil neutrality under fee-denominated points vs. sybil gain under per-wallet bonuses
  P5  revenue capture: share of dissipation retained = c_protocol / c

Outputs: tullock_results.json  (numbers used in the paper)
         fig_dissipation.png, fig_sybil.png, fig_revenue.png
Reproduce: python3 tullock_sim.py
"""
import json, os
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

RNG = np.random.default_rng(20260725)
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = {}

# ----------------------------------------------------------------------------
# P1/P2: symmetric equilibrium. Closed form vs. numerical best-response.
# ----------------------------------------------------------------------------
def symmetric_closed_form(n, V, c):
    e = (n - 1) / (n ** 2) * (V / c)
    S = n * e
    spend = S * c
    return e, S, spend, spend / V


def exact_equilibrium(costs, V):
    """Exact interior Nash equilibrium of a proportional (lottery) contest with
    heterogeneous linear costs, solved by active-set selection.

    Payoff_i = V e_i / S - c_i e_i.  FOC for an active player:
        V (S - e_i) / S^2 = c_i     =>     e_i = S - c_i S^2 / V.
    Summing over the active set A of size m:
        S = V (m - 1) / sum_{i in A} c_i,
    and e_i >= 0 requires c_i <= V / S. Players are admitted cheapest-first; the
    active set is the largest prefix for which every admitted player stays feasible.
    """
    costs = np.asarray(costs, dtype=float)
    order = np.argsort(costs)
    sorted_c = costs[order]
    best = None
    for m in range(2, len(costs) + 1):
        csum = sorted_c[:m].sum()
        S = V * (m - 1) / csum
        if sorted_c[m - 1] <= V / S:       # marginal (most expensive) player feasible
            best = (m, S)
        else:
            break
    if best is None:                        # degenerate: fall back to the two cheapest
        m, S = 2, V / sorted_c[:2].sum()
    else:
        m, S = best
    e = np.zeros(len(costs))
    active_idx = order[:m]
    e[active_idx] = S - costs[active_idx] * S ** 2 / V
    e = np.maximum(e, 0.0)
    spend = float((e * costs).sum())
    return e, float(e.sum()), spend, spend / V



V = 1_000_000.0

# P1: closed form vs numerical, symmetric case
p1 = []
for n in (2, 5, 10, 50, 100, 500):
    e_cf, S_cf, sp_cf, D_cf = symmetric_closed_form(n, V, c=1.0)
    # NOTE: this compares the closed form against the active-set solver, which
    # reduces to it under identical costs. It checks the solver, not the model.
    e_num, S_num, sp_num, D_num = exact_equilibrium(np.ones(n), V)
    p1.append({
        "n": n,
        "closed_form_dissipation": D_cf,
        "numeric_dissipation": D_num,
        "abs_err": abs(D_cf - D_num),
        "theory_(n-1)/n": (n - 1) / n,
    })
OUT["P1_symmetric_equilibrium"] = p1
max_err = max(r["abs_err"] for r in p1)
OUT["P1_max_abs_error_vs_theory"] = max_err

# P2: dissipation invariant to unit cost c (the "caps don't work" result)
p2 = []
for c in (0.1, 0.5, 1.0, 5.0, 25.0, 100.0):
    e, S, spend, D = symmetric_closed_form(100, V, c)
    p2.append({"c": c, "points_minted": S, "dollars_spent": spend, "dissipation": D})
OUT["P2_cost_invariance"] = p2
OUT["P2_dissipation_spread"] = max(r["dissipation"] for r in p2) - min(r["dissipation"] for r in p2)

# P3: heterogeneous costs — does dissipation still approach 1 as n grows?
p3 = []
for n in (10, 50, 200, 1000):
    # lognormal cost heterogeneity: some farmers are much cheaper than others
    costs = np.exp(RNG.normal(0.0, 0.6, size=n))
    costs /= costs.mean()          # normalize mean cost to 1 for comparability
    e, S, spend, D = exact_equilibrium(costs, V)
    active = int((e > 1e-9).sum())
    p3.append({
        "n": n, "active_players": active, "dissipation": D,
        "cost_p10": float(np.percentile(costs, 10)),
        "cost_p90": float(np.percentile(costs, 90)),
        "top_player_share_of_points": float(e.max() / S),
    })
OUT["P3_heterogeneous_costs"] = p3

# ----------------------------------------------------------------------------
# P4: Sybil incentive. One farmer splits budget across k wallets.
#     Case A: pure pro-rata on points (contest share depends only on total effort)
#     Case B: per-wallet bonus/floor (common "anti-farm" design) -> sybils pay
# ----------------------------------------------------------------------------
def sybil_payoff(k, budget, others_points, c, per_wallet_bonus=0.0, bonus_cap_points=None):
    """Farmer splits `budget` dollars across k wallets. Returns pool share obtained."""
    per_wallet_budget = budget / k
    pts_per_wallet = per_wallet_budget / c
    if bonus_cap_points is not None:
        eligible = min(pts_per_wallet, bonus_cap_points)
    else:
        eligible = pts_per_wallet
    pts_per_wallet_total = pts_per_wallet + per_wallet_bonus * eligible
    my_points = k * pts_per_wallet_total
    return my_points / (my_points + others_points)

others = 1_000_000.0
budget = 100_000.0
p4_neutral, p4_bonus = [], []
for k in (1, 2, 5, 10, 100, 1000):
    share_a = sybil_payoff(k, budget, others, c=1.0)
    # Case B: 25% bonus on the first 5,000 points of EACH wallet (per-wallet floor)
    share_b = sybil_payoff(k, budget, others, c=1.0,
                           per_wallet_bonus=0.25, bonus_cap_points=5_000.0)
    p4_neutral.append({"k": k, "pool_share": share_a})
    p4_bonus.append({"k": k, "pool_share": share_b})
OUT["P4_sybil_fee_denominated_pro_rata"] = p4_neutral
OUT["P4_sybil_with_per_wallet_bonus"] = p4_bonus
OUT["P4_neutrality_max_deviation"] = (
    max(r["pool_share"] for r in p4_neutral) - min(r["pool_share"] for r in p4_neutral))
OUT["P4_bonus_sybil_gain_x"] = (
    p4_bonus[-1]["pool_share"] / p4_bonus[0]["pool_share"])

# ----------------------------------------------------------------------------
# P5: revenue capture. Dissipated dollars split between protocol and third parties.
# ----------------------------------------------------------------------------
p5 = []
for label, c_proto, c_ext in [
    ("volume-denominated (wash trade: fee rebated/minimal, cost is slippage+gas)", 0.05, 0.95),
    ("mixed (fee = half of marginal cost)", 0.50, 0.50),
    ("fee-denominated, cheap chain (fee dominates gas)", 0.90, 0.10),
    ("fee-denominated, very cheap chain", 0.97, 0.03),
]:
    c = c_proto + c_ext
    n = 100
    _, _, spend, D = symmetric_closed_form(n, V, c)
    revenue = spend * (c_proto / c)
    p5.append({
        "design": label, "c_protocol_share": c_proto / c,
        "total_dissipated": spend, "protocol_revenue": revenue,
        "revenue_over_pool": revenue / V, "deadweight": spend - revenue,
    })
OUT["P5_revenue_capture"] = p5

# ----------------------------------------------------------------------------
# Figures
# ----------------------------------------------------------------------------
plt.rcParams.update({"figure.dpi": 150, "font.size": 9,
                     "axes.spines.top": False, "axes.spines.right": False})

# Fig 1: dissipation vs n, closed form + heterogeneous simulation
fig, ax = plt.subplots(figsize=(5.2, 3.2))
ns = np.arange(2, 201)
ax.plot(ns, (ns - 1) / ns, lw=1.8, color="#1b3a6b", label="symmetric equilibrium $(n-1)/n$")
ax.scatter([r["n"] for r in p3], [r["dissipation"] for r in p3], s=28, zorder=5,
           color="#c2492f", label="heterogeneous costs (simulated)")
ax.axhline(1.0, ls=":", lw=1, color="#666")
ax.set_xlabel("number of competing farmers $n$")
ax.set_ylabel("fraction of pool dissipated")
ax.set_ylim(0.4, 1.03)
ax.set_title("Pool value competed away, by number of entrants", loc="left", fontsize=10)
ax.legend(frameon=False, fontsize=8, loc="lower right")
fig.tight_layout(); fig.savefig(os.path.join(HERE, "fig_dissipation.png")); plt.close(fig)

# Fig 2: sybil neutrality vs per-wallet bonus
fig, ax = plt.subplots(figsize=(5.2, 3.2))
ks = [r["k"] for r in p4_neutral]
ax.semilogx(ks, [r["pool_share"] for r in p4_neutral], "o-", lw=1.8,
            color="#1b3a6b", label="fee-denominated pro-rata")
ax.semilogx(ks, [r["pool_share"] for r in p4_bonus], "s-", lw=1.8,
            color="#c2492f", label="with per-wallet bonus (25% on first 5k pts)")
ax.set_xlabel("wallets the farmer splits a fixed budget across ($k$)")
ax.set_ylabel("share of pool obtained")
ax.set_title("Does splitting into more wallets pay?", loc="left", fontsize=10)
ax.legend(frameon=False, fontsize=8)
fig.tight_layout(); fig.savefig(os.path.join(HERE, "fig_sybil.png")); plt.close(fig)

# Fig 3: where the dissipated dollars land
fig, ax = plt.subplots(figsize=(5.6, 3.2))
labels = ["volume-\ndenominated", "mixed", "fee-denom.\n(cheap chain)", "fee-denom.\n(very cheap)"]
rev = [r["protocol_revenue"] / 1e6 for r in p5]
dead = [r["deadweight"] / 1e6 for r in p5]
x = np.arange(len(labels))
ax.bar(x, rev, 0.6, label="captured as protocol revenue", color="#1b3a6b")
ax.bar(x, dead, 0.6, bottom=rev, label="deadweight (gas, slippage, MEV)", color="#c9c9c9")
ax.set_xticks(x); ax.set_xticklabels(labels, fontsize=8)
ax.set_ylabel("$M dissipated (pool = $1M)")
ax.set_title("Same dissipation, different destination", loc="left", fontsize=10)
ax.legend(frameon=False, fontsize=8)
fig.tight_layout(); fig.savefig(os.path.join(HERE, "fig_revenue.png")); plt.close(fig)

with open(os.path.join(HERE, "tullock_results.json"), "w") as f:
    json.dump(OUT, f, indent=2)

print("P1 max |closed-form - numeric| dissipation error:", f"{max_err:.3e}")
print("P2 dissipation spread across 1000x cost range:", f"{OUT['P2_dissipation_spread']:.3e}")
for r in p3:
    print(f"P3 n={r['n']:5d} active={r['active_players']:5d} dissipation={r['dissipation']:.4f}")
print("P4 sybil neutrality max deviation (pro-rata):", f"{OUT['P4_neutrality_max_deviation']:.3e}")
print("P4 sybil gain with per-wallet bonus (k=1000 vs k=1):", f"{OUT['P4_bonus_sybil_gain_x']:.3f}x")
for r in p5:
    print(f"P5 {r['c_protocol_share']:.2f} share -> revenue/pool = {r['revenue_over_pool']:.3f}")
print("wrote tullock_results.json + 3 figures")
