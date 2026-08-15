#!/usr/bin/env python3
"""
Monte Carlo sampling distributions for the heterogeneous-cost contest results.

The first draft reported one realization per cost-dispersion level, which gives
point estimates with no sense of how much of the spread is sampling noise. This
draws 500 independent cost vectors per sigma and reports medians with [p5, p95]
bands, and separately measures how the sybil result depends on the competing-
effort assumption that was previously fixed at a single value.

Output: data/tullock_mc.json
"""
import json, os
import numpy as np
from tullock_sim import exact_equilibrium

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(os.path.dirname(HERE), "data")
RNG = np.random.default_rng(20260726)

V = 1_000_000.0
N = 5_000
DRAWS = 500
SIGMAS = [0.2, 0.4, 0.6, 1.0]

OUT = {"prize_V": V, "n_potential_entrants": N, "draws_per_sigma": DRAWS,
       "seed": 20260726, "results": []}

print(f"{DRAWS} draws per sigma, n={N:,} potential entrants, V=${V:,.0f}\n")
print(f"{'sigma':>5} | {'active (median [p5,p95])':>26} | {'dissipation':>24} | "
      f"{'top-1 share of pool':>24} | {'farmer surplus':>22}")
print("-" * 118)

for sig in SIGMAS:
    act, dis, top1, surp = [], [], [], []
    for _ in range(DRAWS):
        c = np.exp(RNG.normal(0.0, sig, N))
        c /= c.mean()
        e, S, spend, D = exact_equilibrium(c, V)
        a = e > 1e-9
        act.append(int(a.sum()))
        dis.append(D)
        share = V * e[a] / S                      # dollars of pool won
        top1.append(float(share.max() / V))
        surp.append(float((share - c[a] * e[a]).sum() / V))

    def band(x):
        x = np.asarray(x, float)
        return [float(np.median(x)), float(np.percentile(x, 5)), float(np.percentile(x, 95))]

    row = {"sigma": sig, "active": band(act), "dissipation": band(dis),
           "top1_share": band(top1), "farmer_surplus": band(surp)}
    OUT["results"].append(row)
    f = lambda b, p=3: f"{b[0]:.{p}f} [{b[1]:.{p}f}, {b[2]:.{p}f}]"
    print(f"{sig:>5} | {f(row['active'],0):>26} | {f(row['dissipation']):>24} | "
          f"{f(row['top1_share']):>24} | {f(row['farmer_surplus']):>22}")

# monotonicity across sigma, on medians
meds = {k: [r[k][0] for r in OUT["results"]] for k in ("active", "dissipation", "top1_share", "farmer_surplus")}
OUT["monotone_in_sigma"] = {
    "active_decreasing": bool(all(x > y for x, y in zip(meds["active"], meds["active"][1:]))),
    "dissipation_decreasing": bool(all(x > y for x, y in zip(meds["dissipation"], meds["dissipation"][1:]))),
    "top1_increasing": bool(all(x < y for x, y in zip(meds["top1_share"], meds["top1_share"][1:]))),
    "surplus_increasing": bool(all(x < y for x, y in zip(meds["farmer_surplus"], meds["farmer_surplus"][1:]))),
}
print("\nmonotone in sigma (medians):", OUT["monotone_in_sigma"])

# ---------------------------------------------------------------- sybil sensitivity
# The reported 1.209x gain held competing effort fixed. It is a function of that
# choice, so report the curve rather than the point.
def sybil_share(k, budget, others, c=1.0, bonus=0.0, cap=None):
    per = budget / k
    pts = per / c
    elig = min(pts, cap) if cap is not None else pts
    mine = k * (pts + bonus * elig)
    return mine / (mine + others)

BUDGET = 100_000.0
sens = []
for others in (100_000.0, 500_000.0, 1_000_000.0, 5_000_000.0, 20_000_000.0):
    g1 = sybil_share(1, BUDGET, others, bonus=0.25, cap=5_000.0)
    gk = sybil_share(1000, BUDGET, others, bonus=0.25, cap=5_000.0)
    neutral = (sybil_share(1000, BUDGET, others) - sybil_share(1, BUDGET, others))
    sens.append({"competing_effort_points": others, "gain_x": gk / g1,
                 "fee_denominated_deviation": neutral})
OUT["sybil_sensitivity"] = {
    "budget_usd": BUDGET, "bonus": 0.25, "bonus_cap_points": 5000.0,
    "note": "gain from splitting a fixed budget across 1,000 wallets vs 1, "
            "under a per-wallet bonus; fee-denominated points are invariant at every level",
    "rows": sens,
}
print("\nSYBIL GAIN vs competing effort (per-wallet bonus design)")
for r in sens:
    print(f"  competing effort {r['competing_effort_points']:>12,.0f} pts -> "
          f"{r['gain_x']:.3f}x   (fee-denominated deviation {r['fee_denominated_deviation']:+.1e})")
OUT["sybil_gain_range_x"] = [min(r["gain_x"] for r in sens), max(r["gain_x"] for r in sens)]

json.dump(OUT, open(os.path.join(DATA, "tullock_mc.json"), "w"), indent=2)
print("\nwrote data/tullock_mc.json")
