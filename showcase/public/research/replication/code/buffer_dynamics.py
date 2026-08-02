#!/usr/bin/env python3
"""Buffer dynamics for Paper 1 v3: flow coupling, level tests, discrete operations.

Distinguishes three hypotheses about the post-consolidation collateral buffer:
  H1 (proportional policy): collateral managed to a target ratio k > 1.
     Predicts beta(dC on dL) ~ k, corr(B, L) > 0 in levels.
  H2 (inert residual): a fixed dollar stock diluted by growth.
     Predicts beta ~ 1, corr(B, L) ~ 0, and NO large discrete buffer moves.
  H3 (operated, non-proportional): flows mechanically matched (lock-and-mint),
     plus discrete discretionary lockbox operations unrelated to system size.
     Predicts beta ~ 1, corr(B, L) ~ 0, and large |dB| events not matched to dL.

The data reject H1 (corr(B,L) = -0.10; 45bp at the system's peak) and reject the
"inert" half of H2 (eight |dB| > $100m events, incl. +$508m in / -$597m out with
flat liabilities). What survives is H3. The exceedance itself (0 of 165 below
par) is the only margin the operations visibly maintain.

Also runs the flow-coupling regression per regime: beta ~ 1 in BOTH regimes,
so marginal flow routed through the lockbox even pre-consolidation - the
pre-break shortfall was a legacy STOCK problem, not an ongoing flow problem.

Usage: python3 buffer_dynamics.py   (expects ../data/usdt0_timeseries.csv)
Writes ../data/buffer_dynamics.json
"""
import csv
import json
import math
import os
import statistics as st

HERE = os.path.dirname(os.path.abspath(__file__))
TS = os.path.join(HERE, "..", "data", "usdt0_timeseries.csv")
OUT = os.path.join(HERE, "..", "data", "buffer_dynamics.json")

PRE_END = "2025-08-25"     # last pre-break observation (16 obs)
POST_START = "2025-08-31"  # first post-break observation (165 obs);
                           # 2025-08-27/29 are the transition pair, excluded.
NW_MAXLAGS = 4             # matches robustness.py

def corr(x, y):
    n = len(x)
    mx, my = sum(x) / n, sum(y) / n
    sxy = sum((x[i] - mx) * (y[i] - my) for i in range(n))
    sxx = sum((xi - mx) ** 2 for xi in x)
    syy = sum((yi - my) ** 2 for yi in y)
    return sxy / math.sqrt(sxx * syy)

def ols_nw(y, x, maxlags=NW_MAXLAGS):
    """OLS slope with Newey-West HAC standard error."""
    n = len(y)
    mx, my = sum(x) / n, sum(y) / n
    sxx = sum((xi - mx) ** 2 for xi in x)
    b = sum((x[i] - mx) * (y[i] - my) for i in range(n)) / sxx
    a = my - b * mx
    e = [y[i] - a - b * x[i] for i in range(n)]
    z = [(x[i] - mx) * e[i] for i in range(n)]
    s = sum(zi * zi for zi in z)
    for l in range(1, maxlags + 1):
        w = 1 - l / (maxlags + 1)
        s += 2 * w * sum(z[i] * z[i - l] for i in range(l, n))
    return b, math.sqrt(s) / sxx

def diffs(vals):
    return [vals[i] - vals[i - 1] for i in range(1, len(vals))]

rows = [r for r in csv.DictReader(open(TS)) if r.get("ratio")]
pre = [r for r in rows if r["date"] <= PRE_END]
post = [r for r in rows if r["date"] >= POST_START]

out = {"pre_break": {}, "post_break": {}, "buffer_post_break": {}}

for name, sel in (("pre_break", pre), ("post_break", post)):
    C = [float(r["collateral"]) for r in sel]
    L = [float(r["liabilities"]) for r in sel]
    dC, dL = diffs(C), diffs(L)
    b, se = ols_nw(dC, dL)
    out[name] = {
        "n_obs": len(sel),
        "n_diffs": len(dC),
        "corr_dC_dL": round(corr(dC, dL), 4),
        "beta_dC_on_dL": round(b, 4),
        "beta_nw_se": round(se, 4),
        "t_beta_eq_1": round((b - 1) / se, 2),
        "t_beta_eq_0": round(b / se, 2),
    }

# Per-leg pre-break flow regressions (the correctly-specified test): under the
# split-backing attribution, the lockbox should match NON-Polygon flow and the
# predicate should match Polygon flow. Regressing lockbox-only flow on TOTAL
# liability flow (as the aggregate regime regression above does) mixes in the
# ~15% of variance that is Polygon flow the lockbox never backed, which is what
# produced the beta=0.89 "anomaly" in the first draft of this analysis.
try:
    import json as _json
    _pred = _json.load(open(os.path.join(HERE, "..", "data",
                            "polygon_predicate_prebreak.json")))["balances_usd"]
    _lock = [float(r["collateral"]) for r in pre]
    _L = [float(r["liabilities"]) for r in pre]
    _poly = [float(r["supply_Polygon"]) for r in pre]
    _P = [_pred[r["date"]] for r in pre]
    _nonpoly = [_L[i] - _poly[i] for i in range(len(_L))]
    out["pre_break_per_leg"] = {}
    for nm, y, x in (
        ("dLockbox_on_dNonPolygonL", diffs(_lock), diffs(_nonpoly)),
        ("dPredicate_on_dPolygonL", diffs(_P), diffs(_poly)),
        ("dLockPlusPred_on_dTotalL",
         diffs([_lock[i] + _P[i] for i in range(len(_L))]), diffs(_L)),
    ):
        b, se = ols_nw(y, x)
        out["pre_break_per_leg"][nm] = {
            "beta": round(b, 4), "nw_se": round(se, 4),
            "corr": round(corr(y, x), 4),
        }
except FileNotFoundError:
    pass  # predicate backfill not present; aggregate regressions still emitted

C = [float(r["collateral"]) for r in post]
L = [float(r["liabilities"]) for r in post]
D = [r["date"] for r in post]
B = [C[i] - L[i] for i in range(len(C))]
dB, dL = diffs(B), diffs(L)
dC = diffs(C)

i_lpeak = L.index(max(L))
i_bmax = B.index(max(B))
big = [i for i in range(len(dB)) if abs(dB[i]) > 100e6]  # full census, not a top-k
out["buffer_post_break"] = {
    "corr_B_L_levels": round(corr(B, L), 4),
    "corr_dB_dL": round(corr(dB, dL), 4),
    "mean_dB_usd": round(st.mean(dB), 0),
    "buffer_at_L_peak": {
        "date": D[i_lpeak],
        "liabilities": round(L[i_lpeak], 0),
        "buffer": round(B[i_lpeak], 0),
        "buffer_bp": round(1e4 * B[i_lpeak] / L[i_lpeak], 1),
    },
    "buffer_max": {
        "date": D[i_bmax],
        "buffer": round(B[i_bmax], 0),
        "liabilities": round(L[i_bmax], 0),
    },
    "share_steps_abs_dB_lt_10m": round(
        sum(1 for x in dB if abs(x) < 10e6) / len(dB), 4
    ),
    "terminal_drawdown": {
        "note": ("the buffer was wound down across 2026 and collapsed to "
                 "measurement noise at sample end; the final-8-day move is "
                 "discretionary (collateral fell far beyond liability decline)"),
        "buffer_2025_12_31": round(next(B[i] for i in range(len(B)) if D[i] == "2025-12-31"), 0),
        "buffer_2026_07_17": round(next(B[i] for i in range(len(B)) if D[i] == "2026-07-17"), 0),
        "buffer_2026_07_25": round(B[-1], 0),
        "final_8d_dCollateral": round(C[-1] - next(C[i] for i in range(len(C)) if D[i] == "2026-07-17"), 0),
        "final_8d_dLiabilities": round(L[-1] - next(L[i] for i in range(len(L)) if D[i] == "2026-07-17"), 0),
    },
    "largest_dB_steps": [
        {
            "from": D[i],
            "to": D[i + 1],
            "dB": round(dB[i], 0),
            "dL": round(dL[i], 0),
            "dC": round(dC[i], 0),
        }
        for i in sorted(big)
    ],
}

with open(OUT, "w") as f:
    json.dump(out, f, indent=2)

print(json.dumps(out, indent=2))
print(f"\nwrote {OUT}")
