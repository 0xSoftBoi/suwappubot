#!/usr/bin/env python3
"""
Analysis of the USDT0 collateral panel.

Computes the reconciliation series:
    liabilities(t) = sum of USDT0 totalSupply() across remote chains at time t
    collateral(t)  = USDT held by the OAdapter lockbox on Ethereum at time t
    ratio(t)       = collateral / liabilities

and the provenance controls (legacy canonical-bridge escrows on Ethereum).

Outputs: usdt0_timeseries.csv, usdt0_summary.json,
         fig_collateral.png, fig_ratio.png, fig_composition.png
"""
import csv, json, os
from collections import defaultdict
from datetime import datetime, timezone
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.dates as mdates

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DATA = os.path.join(ROOT, "data")
FIGS = os.path.join(ROOT, "figures")
PANEL = os.path.join(DATA, "usdt0_panel.csv")

LOCKBOX = "USDT0_lockbox"
LEGACY = {"Optimism_L1Bridge", "Arbitrum_L1Gateway", "Polygon_ERC20Pred"}

rows = list(csv.DictReader(open(PANEL)))
by_ts = defaultdict(dict)
status = defaultdict(dict)
for r in rows:
    ts = int(r["ts"])
    v = float(r["value_usd"])
    by_ts[ts][r["entity"]] = v
    status[ts][r["entity"]] = r["status"]

chains = sorted({r["entity"] for r in rows
                 if r["entity"] != LOCKBOX and r["entity"] not in LEGACY})
klass = {r["entity"]: r["class"] for r in rows}

# Coverage: a timestamp is usable only if we observed the lockbox.
tss = sorted(t for t in by_ts if LOCKBOX in by_ts[t])

series = []
for t in tss:
    d = by_ts[t]
    liab = sum(d.get(c, 0.0) for c in chains)
    # count chains with a genuine live read (not pre-history / rpc-error)
    live = sum(1 for c in chains if status[t].get(c) == "ok")
    errs = sum(1 for c in chains if status[t].get(c) == "rpc-error")
    coll = d.get(LOCKBOX, 0.0)
    legacy_total = sum(d.get(l, 0.0) for l in LEGACY)
    series.append({
        "ts": t,
        "date": datetime.fromtimestamp(t, timezone.utc).strftime("%Y-%m-%d"),
        "collateral": coll,
        "liabilities": liab,
        "ratio": (coll / liab) if liab > 0 else float("nan"),
        "gap": coll - liab,
        "chains_live": live,
        "chains_rpc_error": errs,
        "legacy_escrows": legacy_total,
        **{f"supply_{c}": d.get(c, 0.0) for c in chains},
        **{f"escrow_{l}": d.get(l, 0.0) for l in sorted(LEGACY)},
    })

# Restrict headline stats to observations with full chain coverage (no rpc errors)
clean = [s for s in series if s["chains_rpc_error"] == 0 and s["liabilities"] > 0]

with open(os.path.join(DATA, "usdt0_timeseries.csv"), "w", newline="") as f:
    w = csv.DictWriter(f, fieldnames=list(series[0].keys()))
    w.writeheader()
    w.writerows(series)

ratios = np.array([s["ratio"] for s in clean])
gaps = np.array([s["gap"] for s in clean])
latest = clean[-1] if clean else None

summary = {
    "observations_total": len(series),
    "observations_clean": len(clean),
    "date_range": [series[0]["date"], series[-1]["date"]] if series else None,
    "chains_measured": chains,
    "latest": {k: latest[k] for k in
               ("date", "collateral", "liabilities", "ratio", "gap", "chains_live")} if latest else None,
    "ratio_stats": {
        "min": float(np.nanmin(ratios)), "max": float(np.nanmax(ratios)),
        "mean": float(np.nanmean(ratios)), "median": float(np.nanmedian(ratios)),
        "std": float(np.nanstd(ratios)),
        "frac_below_1": float(np.mean(ratios < 1.0)),
        "n_below_1": int(np.sum(ratios < 1.0)),
    },
    "gap_stats_usd": {
        "min": float(np.nanmin(gaps)), "max": float(np.nanmax(gaps)),
        "mean": float(np.nanmean(gaps)), "median": float(np.nanmedian(gaps)),
    },
    "latest_chain_breakdown": (
        sorted(((c, latest[f"supply_{c}"], klass.get(c, "")) for c in chains),
               key=lambda x: -x[1]) if latest else []),
    "legacy_escrow_latest": {l: latest[f"escrow_{l}"] for l in sorted(LEGACY)} if latest else {},
}
json.dump(summary, open(os.path.join(DATA, "usdt0_summary.json"), "w"), indent=2, default=float)

# ---------------- figures ----------------
plt.rcParams.update({"figure.dpi": 150, "font.size": 9,
                     "axes.spines.top": False, "axes.spines.right": False})
dates = [datetime.fromtimestamp(s["ts"], timezone.utc) for s in clean]

fig, ax = plt.subplots(figsize=(6.4, 3.4))
ax.plot(dates, [s["collateral"] / 1e9 for s in clean], lw=1.8,
        color="#1b3a6b", label="collateral: USDT in OAdapter lockbox")
ax.plot(dates, [s["liabilities"] / 1e9 for s in clean], lw=1.8,
        color="#c2492f", label="liabilities: Σ USDT0 supply across chains")
ax.set_ylabel("$B"); ax.legend(frameon=False, fontsize=8)
ax.set_title("USDT0: collateral vs. omnichain liabilities", loc="left", fontsize=10)
ax.xaxis.set_major_formatter(mdates.DateFormatter("%b %Y"))
fig.autofmt_xdate(); fig.tight_layout()
fig.savefig(os.path.join(FIGS, "fig_collateral.png")); plt.close(fig)

fig, ax = plt.subplots(figsize=(6.4, 3.4))
ax.plot(dates, ratios, lw=1.6, color="#1b3a6b")
ax.axhline(1.0, ls="--", lw=1.2, color="#c2492f", label="full collateralization")
ax.set_ylabel("collateral / liabilities")
ax.set_title("Collateralization ratio", loc="left", fontsize=10)
ax.legend(frameon=False, fontsize=8)
ax.xaxis.set_major_formatter(mdates.DateFormatter("%b %Y"))
fig.autofmt_xdate(); fig.tight_layout()
fig.savefig(os.path.join(FIGS, "fig_ratio.png")); plt.close(fig)

# composition: stacked supply by chain (top 8 + other)
top = [c for c, _, _ in summary["latest_chain_breakdown"][:8]] if latest else chains[:8]
fig, ax = plt.subplots(figsize=(6.4, 3.6))
stack = [[s[f"supply_{c}"] / 1e9 for s in clean] for c in top]
other = [sum(s[f"supply_{c}"] for c in chains if c not in top) / 1e9 for s in clean]
ax.stackplot(dates, *stack, other, labels=top + ["other"],
             colors=plt.cm.tab20.colors[:len(top) + 1])
ax.set_ylabel("$B"); ax.set_title("Where omnichain USDT supply sits", loc="left", fontsize=10)
ax.legend(frameon=False, fontsize=7, ncol=3, loc="upper left")
ax.xaxis.set_major_formatter(mdates.DateFormatter("%b %Y"))
fig.autofmt_xdate(); fig.tight_layout()
fig.savefig(os.path.join(FIGS, "fig_composition.png")); plt.close(fig)

print(f"observations: {len(series)} total, {len(clean)} with full coverage")
if latest:
    print(f"latest ({latest['date']}): collateral ${latest['collateral']:,.0f} | "
          f"liabilities ${latest['liabilities']:,.0f} | ratio {latest['ratio']:.4f}")
print(f"ratio min={summary['ratio_stats']['min']:.4f} max={summary['ratio_stats']['max']:.4f} "
      f"median={summary['ratio_stats']['median']:.4f} below1={summary['ratio_stats']['n_below_1']}")
print("legacy escrows latest:", summary["legacy_escrow_latest"])
print("\ntop chains by supply (latest):")
for c, v, k in summary["latest_chain_breakdown"][:14]:
    print(f"  {c:12s} ${v:15,.0f}  [{k}]")
