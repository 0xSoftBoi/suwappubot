#!/usr/bin/env python3
"""
Publication exhibits for both papers.

House style: restrained two-hue categorical palette (validated for CVD separation
and contrast), recessive grid, thin marks, direct labels on <=4 series, source
line under every exhibit, no dual axes.

Outputs figures/exhibit-N-*.png
"""
import csv, json, os
from datetime import datetime, timezone
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.dates as mdates
from matplotlib.ticker import FuncFormatter

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DATA = os.path.join(ROOT, "data")
FIGS = os.path.join(ROOT, "figures")
os.makedirs(FIGS, exist_ok=True)

# validated categorical slots (see dataviz validator: all checks PASS, light mode)
BLUE, ORANGE = "#2a78d6", "#eb6834"
INK, INK2, MUTED, GRID = "#0b0b0b", "#52514e", "#8a8a86", "#e6e6e2"
SERIES = [BLUE, ORANGE, "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"]

plt.rcParams.update({
    "figure.dpi": 200, "savefig.dpi": 200,
    "font.size": 8.5, "font.family": "DejaVu Sans",
    "axes.spines.top": False, "axes.spines.right": False,
    "axes.spines.left": False,
    "axes.edgecolor": MUTED, "axes.labelcolor": INK2,
    "xtick.color": INK2, "ytick.color": INK2,
    "xtick.major.size": 0, "ytick.major.size": 0,
    "axes.grid": True, "grid.color": GRID, "grid.linewidth": 0.6,
    "axes.axisbelow": True, "legend.frameon": False,
    "savefig.bbox": "tight", "savefig.facecolor": "white",
    # dollar amounts appear throughout; without this, a pair of $ in any label
    # is parsed as LaTeX math and silently mangles the text
    "text.parse_math": False,
})


def frame(ax, title, subtitle=None, source=None, ylab=None):
    # subtitle sits directly above the axes; the title clears it by however
    # many lines the subtitle occupies
    n_lines = subtitle.count("\n") + 1 if subtitle else 0
    ax.set_title(title, loc="left", fontsize=10, color=INK,
                 pad=8 + 11 * n_lines, fontweight="bold")
    if subtitle:
        ax.annotate(subtitle, xy=(0, 1.0), xycoords="axes fraction",
                    xytext=(0, 5), textcoords="offset points",
                    fontsize=8, color=INK2, va="bottom", linespacing=1.35)
    if ylab:
        ax.set_ylabel(ylab, fontsize=8, color=INK2)
    if source:
        ax.annotate(source, xy=(0, -0.16), xycoords="axes fraction",
                    fontsize=6.8, color=MUTED, va="top")
    ax.grid(axis="x", visible=False)


def usd_b(x, _):
    return f"${x:,.0f}bn" if x else "0"


# ---------------------------------------------------------------- paper 1 data
rows = list(csv.DictReader(open(os.path.join(DATA, "usdt0_timeseries.csv"))))
dates = [datetime.fromtimestamp(int(r["ts"]), timezone.utc) for r in rows]
coll = np.array([float(r["collateral"]) for r in rows]) / 1e9
liab = np.array([float(r["liabilities"]) for r in rows]) / 1e9
ratio = np.array([float(r["ratio"]) for r in rows])
gap = np.array([float(r["gap"]) for r in rows]) / 1e6
post_mask = np.array([r["date"] >= "2025-08-30" for r in rows])
BREAK = datetime(2025, 8, 27, 18, tzinfo=timezone.utc)

SRC1 = ("Source: Suwappu Research. Direct archive eth_call reads at block heights aligned to each sample\n"
        "timestamp; 183 observations at 48-hour intervals across 18 documented EVM deployments. The number\n"
        "of chains returning live supply rises from 9 to 16 over the sample; see Exhibit 2, lower panel.")

# Exhibit 1 — collateral vs liabilities
fig, ax = plt.subplots(figsize=(6.6, 3.5))
ax.plot(dates, coll, lw=2, color=BLUE, label="Collateral (lockbox USDT)", solid_capstyle="round")
ax.plot(dates, liab, lw=2, color=ORANGE, label="Liabilities (Σ cross-chain supply)",
        solid_capstyle="round")
ax.axvline(BREAK, color=MUTED, lw=1, ls=(0, (3, 3)))
ax.annotate("27 Aug 2025: +$1.26bn into the\nlockbox against flat liabilities", xy=(BREAK, 1.5),
            xytext=(9, -2), textcoords="offset points", fontsize=7, color=INK2, va="center")
ax.annotate("Collateral", xy=(dates[-1], coll[-1]), xytext=(7, 5), textcoords="offset points",
            fontsize=8, color=BLUE, fontweight="bold")
ax.annotate("Liabilities", xy=(dates[-1], liab[-1]), xytext=(7, -11), textcoords="offset points",
            fontsize=8, color=ORANGE, fontweight="bold")
ax.yaxis.set_major_formatter(FuncFormatter(usd_b))
ax.xaxis.set_major_locator(mdates.MonthLocator(interval=2))
ax.xaxis.set_major_formatter(mdates.DateFormatter("%b %y"))
ax.set_xlim(dates[0], dates[-1] + (dates[-1] - dates[-12]))
ax.set_ylim(0.8, 8.4)
frame(ax, "Exhibit 1  Collateral steps up to meet liabilities in August 2025",
      "USDT0 lockbox collateral vs. aggregate cross-chain minted supply, $bn", SRC1)
fig.savefig(os.path.join(FIGS, "exhibit-1-collateral.png")); plt.close(fig)

# Exhibit 2 — ratio, with the coverage that partly drives it
covered = np.array([int(r["chains_live"]) for r in rows])
fig, (axr, axc) = plt.subplots(2, 1, figsize=(6.6, 5.0), sharex=True,
                               gridspec_kw={"hspace": 0.40, "height_ratios": [2.1, 1]})
axr.axhspan(0.4, 1.0, color="#f6f6f4", zorder=0)
axr.plot(dates, ratio, lw=2, color=BLUE, solid_capstyle="round")
axr.axhline(1.0, color=ORANGE, lw=1.4, ls=(0, (4, 3)))
axr.annotate("Full backing (1.00)", xy=(dates[3], 1.0), xytext=(0, 6),
             textcoords="offset points", fontsize=7.5, color=ORANGE, fontweight="bold")
axr.annotate("Pre-break readings pair supply with an\nescrow that did not yet hold its backing",
             xy=(dates[6], 0.60), fontsize=7, color=INK2)
axr.annotate(f"latest, best-covered reading: {ratio[-1]:.4f}",
             xy=(dates[-1], ratio[-1]), xytext=(-116, -30), textcoords="offset points",
             fontsize=7, color=INK2,
             arrowprops=dict(arrowstyle="-", color=MUTED, lw=0.8))
axr.set_ylim(0.45, 1.24)
frame(axr, "Exhibit 2  The apparent surplus shrinks as the measured universe grows",
      "Lockbox collateral / measured cross-chain liabilities")

axc.fill_between(dates, 0, covered, color=MUTED, alpha=0.25, linewidth=0, step="mid")
axc.step(dates, covered, where="mid", lw=1.6, color=INK2)
axc.set_ylim(0, 18)
axc.set_yticks([0, 4, 8, 12, 16])
axc.xaxis.set_major_locator(mdates.MonthLocator(interval=2))
axc.xaxis.set_major_formatter(mdates.DateFormatter("%b %y"))
frame(axc, "", "Chains returning live supply at each observation", SRC1)
fig.savefig(os.path.join(FIGS, "exhibit-2-ratio.png")); plt.close(fig)

# Exhibit 3 — the buffer, absolute and relative (the relative panel is the risk story)
pd_ = [d for d, m in zip(dates, post_mask) if m]
pg = gap[post_mask]
pl = np.array([float(r["liabilities"]) for r, m in zip(rows, post_mask) if m]) / 1e9
prel = pg / (pl * 1000) * 100          # buffer as % of liabilities
fig, (axa, axb) = plt.subplots(2, 1, figsize=(6.6, 5.0), sharex=True,
                               gridspec_kw={"hspace": 0.42})
axa.fill_between(pd_, 0, pg, color=BLUE, alpha=0.16, linewidth=0)
axa.plot(pd_, pg, lw=1.8, color=BLUE, solid_capstyle="round")
axa.axhline(0, color=INK2, lw=0.9)
ia = int(np.argmin(pg))
axa.plot([pd_[ia]], [pg[ia]], "o", ms=6, color=ORANGE, zorder=5,
         markeredgecolor="white", markeredgewidth=1.5)
axa.annotate(f"smallest in dollars\n${pg[ia]:.0f}m", xy=(pd_[ia], pg[ia]),
             xytext=(16, 34), textcoords="offset points", fontsize=7, color=INK2,
             arrowprops=dict(arrowstyle="-", color=MUTED, lw=0.8))
axa.yaxis.set_major_formatter(FuncFormatter(lambda x, _: f"${x:,.0f}M"))
frame(axa, "Exhibit 3  The buffer does not scale with the system",
      "Collateral less measured liabilities, in dollars")

axb.fill_between(pd_, 0, prel, color=ORANGE, alpha=0.16, linewidth=0)
axb.plot(pd_, prel, lw=1.8, color=ORANGE, solid_capstyle="round")
axb.axhline(0, color=INK2, lw=0.9)
ip = int(np.argmin(prel))
axb.plot([pd_[ip]], [prel[ip]], "o", ms=6, color=BLUE, zorder=5,
         markeredgecolor="white", markeredgewidth=1.5)
axb.annotate(f"thinnest proportionally: {prel[ip]:.2f}%\nat the system's largest",
             xy=(pd_[ip], prel[ip]), xytext=(20, 30), textcoords="offset points",
             fontsize=7, color=INK2,
             arrowprops=dict(arrowstyle="-", color=MUTED, lw=0.8))
axb.yaxis.set_major_formatter(FuncFormatter(lambda x, _: f"{x:.0f}%"))
axb.xaxis.set_major_locator(mdates.MonthLocator(interval=2))
axb.xaxis.set_major_formatter(mdates.DateFormatter("%b %y"))
frame(axb, "", "Same buffer as a share of measured liabilities", SRC1)
fig.savefig(os.path.join(FIGS, "exhibit-3-buffer.png")); plt.close(fig)

# Exhibit 4 — composition
chains = [k[7:] for k in rows[0] if k.startswith("supply_")]
last = rows[-1]
order = sorted(chains, key=lambda c: -float(last[f"supply_{c}"]))
top = order[:5]
fig, ax = plt.subplots(figsize=(6.6, 3.6))
stack = [np.array([float(r[f"supply_{c}"]) for r in rows]) / 1e9 for c in top]
other = np.sum([np.array([float(r[f"supply_{c}"]) for r in rows]) / 1e9
                for c in order[5:]], axis=0)
ax.stackplot(dates, *stack, other, labels=top + ["Other (7 chains)"],
             colors=SERIES[:5] + [MUTED], edgecolor="white", linewidth=0.6)
ax.yaxis.set_major_formatter(FuncFormatter(usd_b))
ax.xaxis.set_major_locator(mdates.MonthLocator(interval=2))
ax.xaxis.set_major_formatter(mdates.DateFormatter("%b %y"))
ax.annotate("Plasma: $5.35bn peak,\n−86% by Jul 2026", xy=(dates[46], 5.4),
            xytext=(18, 14), textcoords="offset points", fontsize=7, color=INK,
            arrowprops=dict(arrowstyle="-", color=INK2, lw=0.8))
frame(ax, "Exhibit 4  Incentive-driven supply arrives and leaves at the same speed",
      "USDT0 supply by chain, $bn", SRC1)
ax.legend(loc="upper right", fontsize=7, ncol=2)
fig.savefig(os.path.join(FIGS, "exhibit-4-composition.png")); plt.close(fig)

# ---------------------------------------------------------------- paper 2 data
res = json.load(open(os.path.join(DATA, "tullock_results.json")))
SRC2 = ("Source: Suwappu Research. Equilibrium solved in closed form for n=5,000 potential entrants,\n"
        "prize $1m; sampling distributions from 500 draws per dispersion level, seed 20260726.\n"
        "Code: code/tullock_sim.py, code/tullock_mc.py, code/verify_equilibrium.py.")

# Exhibit 5 — participation collapse under cost heterogeneity (Monte Carlo)
mc = json.load(open(os.path.join(DATA, "tullock_mc.json")))
sig = [r["sigma"] for r in mc["results"]]
act = [r["active"] for r in mc["results"]]          # [median, p5, p95]
sur = [r["farmer_surplus"] for r in mc["results"]]
x = np.arange(len(sig))
fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(6.8, 3.3), gridspec_kw={"wspace": 0.34})

med = [a[0] for a in act]
err = [[a[0] - a[1] for a in act], [a[2] - a[0] for a in act]]
ax1.bar(x, med, width=0.6, color=BLUE)
ax1.errorbar(x, med, yerr=err, fmt="none", ecolor=INK2, elinewidth=1.1, capsize=4)
for i, a in enumerate(act):
    ax1.annotate(f"{a[0]:.0f}", xy=(i, a[2]), xytext=(0, 4), textcoords="offset points",
                 ha="center", fontsize=8, color=INK, fontweight="bold")
ax1.set_xticks(x); ax1.set_xticklabels([str(v) for v in sig])
ax1.set_ylim(0, 28); ax1.set_yticks([0, 10, 20])
ax1.set_xlabel("cost dispersion \u03c3", fontsize=8, color=INK2)
ax1.set_title("Active operators, of 5,000 potential", loc="left", fontsize=8.5, color=INK)
ax1.grid(axis="x", visible=False)

meds = [v[0] * 100 for v in sur]
errs = [[(v[0] - v[1]) * 100 for v in sur], [(v[2] - v[0]) * 100 for v in sur]]
ax2.bar(x, meds, width=0.6, color=ORANGE)
ax2.errorbar(x, meds, yerr=errs, fmt="none", ecolor=INK2, elinewidth=1.1, capsize=4)
for i, v in enumerate(sur):
    ax2.annotate(f"{v[0]*100:.0f}%", xy=(i, v[2] * 100), xytext=(0, 4),
                 textcoords="offset points", ha="center", fontsize=8,
                 color=INK, fontweight="bold")
ax2.set_xticks(x); ax2.set_xticklabels([str(v) for v in sig])
ax2.set_ylim(0, 58); ax2.set_yticks([0, 20, 40])
ax2.yaxis.set_major_formatter(FuncFormatter(lambda v, _: f"{v:.0f}%"))
ax2.set_xlabel("cost dispersion \u03c3", fontsize=8, color=INK2)
ax2.set_title("Modeled participant surplus", loc="left", fontsize=8.5, color=INK)
ax2.grid(axis="x", visible=False)

fig.suptitle("Exhibit 1  Model benchmark: cost dispersion compresses the active set",
             x=0.005, y=1.07, ha="left", fontsize=10, color=INK, fontweight="bold")
fig.text(0.005, -0.13, "Model output, not an empirical forecast. Bars show the median of 500 draws per \u03c3; "
         "whiskers span the 5th to 95th percentile.\n" + SRC2,
         fontsize=6.8, color=MUTED, ha="left")
fig.savefig(os.path.join(FIGS, "p2-exhibit-1-participation.png")); plt.close(fig)

# Exhibit 6 — where dissipated value lands
p5 = res["P5_revenue_capture"]
labels = ["Volume-\ndenominated", "Mixed", "Fee-denominated\n(low external cost)",
          "Fee-denominated\n(very low external cost)"]
rev = [r["protocol_revenue"] / 1e3 for r in p5]
dead = [r["deadweight"] / 1e3 for r in p5]
fig, ax = plt.subplots(figsize=(6.6, 3.3))
x = np.arange(len(labels))
ax.bar(x, rev, 0.58, color=BLUE, label="Modeled protocol revenue")
ax.bar(x, dead, 0.58, bottom=rev, color=GRID, label="Modeled third-party friction")
for i, (r, d) in enumerate(zip(rev, dead)):
    ax.annotate(f"${r:,.0f}k", xy=(i, r / 2), ha="center", va="center",
                fontsize=7.5, color="white", fontweight="bold")
ax.set_xticks(x); ax.set_xticklabels(labels, fontsize=7.5)
ax.yaxis.set_major_formatter(FuncFormatter(lambda v, _: f"${v:,.0f}k"))
frame(ax, "Exhibit 2  Model identity: denomination changes the destination of spend",
      "Conditional scenario: $990k modeled dissipation on a $1m pool (n=100)", SRC2)
ax.legend(loc="upper left", fontsize=7.5)
fig.savefig(os.path.join(FIGS, "p2-exhibit-2-denomination.png")); plt.close(fig)

print("wrote 6 exhibits to", FIGS)
for f in sorted(os.listdir(FIGS)):
    if f.startswith("exhibit"):
        print("  ", f)
