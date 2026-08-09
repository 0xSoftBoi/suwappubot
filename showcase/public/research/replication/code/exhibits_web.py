#!/usr/bin/env python3
"""
Web exhibits for suwappu.bot/research — same data as the paper exhibits, restyled
to the site's palette and emitted as SVG.

Differences from exhibits.py (which targets print/PDF):
  - site tokens: ink #17324A, muted #4F6F7F, hairline #B9DFE9, series
    #0284C7 (deep sky) and #E58D2B (persimmon). Validated for CVD separation;
    persimmon falls below 3:1 against the warm canvas, so every persimmon series
    carries a direct label rather than relying on color alone.
  - transparent background, so the page canvas shows through in any section.
  - svg.fonttype='none' keeps text as <text> nodes, so headings and labels
    render in the site's own font stack instead of a baked-in outline.

Output: <showcase>/public/research/*.svg
Usage:  python3 exhibits_web.py [output_dir]
        EXHIBIT_ONLY=points-participation.svg python3 exhibits_web.py [output_dir]
"""
import csv, json, os, re, sys
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
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "figures", "web")
os.makedirs(OUT, exist_ok=True)
ONLY = {name.strip() for name in os.getenv("EXHIBIT_ONLY", "").split(",") if name.strip()}

SKY, PERSIMMON = "#0284C7", "#E58D2B"
INK, MUTED, LINE, FAINT = "#17324A", "#4F6F7F", "#B9DFE9", "#DCEDF3"
FONT_STACK = ("Geist, ui-sans-serif, system-ui, -apple-system, "
              "'Segoe UI', Roboto, sans-serif")

plt.rcParams.update({
    "svg.fonttype": "none",          # keep text as text so the site font applies
    "figure.dpi": 100,
    "font.size": 9,
    "axes.spines.top": False, "axes.spines.right": False, "axes.spines.left": False,
    "axes.edgecolor": LINE, "axes.labelcolor": MUTED,
    "xtick.color": MUTED, "ytick.color": MUTED,
    "xtick.major.size": 0, "ytick.major.size": 0,
    "axes.grid": True, "grid.color": FAINT, "grid.linewidth": 0.8,
    "axes.axisbelow": True, "legend.frameon": False,
    "savefig.bbox": "tight", "savefig.transparent": True,
    "text.parse_math": False,
})


def frame(ax, title, subtitle=None, source=None):
    n = subtitle.count("\n") + 1 if subtitle else 0
    ax.set_title(title, loc="left", fontsize=11.5, color=INK,
                 pad=8 + 12 * n, fontweight="semibold")
    if subtitle:
        ax.annotate(subtitle, xy=(0, 1.0), xycoords="axes fraction",
                    xytext=(0, 6), textcoords="offset points",
                    fontsize=8.5, color=MUTED, va="bottom", linespacing=1.4)
    if source:
        ax.annotate(source, xy=(0, -0.17), xycoords="axes fraction",
                    fontsize=7, color=MUTED, va="top", alpha=0.85)
    ax.grid(axis="x", visible=False)


def save(fig, name):
    if ONLY and name not in ONLY:
        plt.close(fig)
        return
    path = os.path.join(OUT, name)
    fig.savefig(path, format="svg")
    plt.close(fig)
    # inherit the site's font stack rather than a baked-in family
    svg = open(path).read()
    svg = re.sub(r"font-family:\s*['\"]?DejaVu Sans['\"]?", f"font-family:{FONT_STACK}", svg)
    svg = svg.replace("<svg ", '<svg role="img" ', 1)
    open(path, "w").write(svg)
    print(f"  {name}  {len(svg)//1024}KB")


# ---------------------------------------------------------------- data
rows = list(csv.DictReader(open(os.path.join(DATA, "usdt0_timeseries.csv"))))
dates = [datetime.fromtimestamp(int(r["ts"]), timezone.utc) for r in rows]
coll = np.array([float(r["collateral"]) for r in rows]) / 1e9
liab = np.array([float(r["liabilities"]) for r in rows]) / 1e9
ratio = np.array([float(r["ratio"]) for r in rows])
gap = np.array([float(r["gap"]) for r in rows]) / 1e6
covered = np.array([int(r["chains_live"]) for r in rows])
post = np.array([r["date"] >= "2025-08-30" for r in rows])
SRC = "Suwappu Research · direct archive eth_call reads · 183 observations, 48h interval, 17 EVM chains"

print(f"writing SVG exhibits to {OUT}")

# --- 1. ratio + coverage (the headline chart) -------------------------------
fig, (a, b) = plt.subplots(2, 1, figsize=(7.2, 5.2), sharex=True,
                           gridspec_kw={"hspace": 0.36, "height_ratios": [2.2, 1]})
a.axhspan(0.4, 1.0, color=FAINT, alpha=0.45, zorder=0)
a.plot(dates, ratio, lw=2.2, color=SKY, solid_capstyle="round")
a.axhline(1.0, color=PERSIMMON, lw=1.6, ls=(0, (4, 3)))
a.annotate("Full backing (1.00)", xy=(dates[2], 1.0), xytext=(0, 7),
           textcoords="offset points", fontsize=8, color=PERSIMMON, fontweight="bold")
a.annotate("Readings here pair supply with an\nescrow that did not yet hold its backing",
           xy=(dates[5], 0.60), fontsize=7.5, color=MUTED)
a.annotate(f"latest: {ratio[-1]:.4f}", xy=(dates[-1], ratio[-1]), xytext=(-78, -26),
           textcoords="offset points", fontsize=8, color=INK, fontweight="semibold",
           arrowprops=dict(arrowstyle="-", color=MUTED, lw=0.9))
a.set_ylim(0.45, 1.24)
frame(a, "The apparent surplus shrinks as the measured universe grows",
      "USDT0 lockbox collateral ÷ measured cross-chain liabilities")
b.fill_between(dates, 0, covered, color=MUTED, alpha=0.16, linewidth=0, step="mid")
b.step(dates, covered, where="mid", lw=1.8, color=MUTED)
b.set_ylim(0, 18); b.set_yticks([0, 8, 16])
b.xaxis.set_major_locator(mdates.MonthLocator(interval=2))
b.xaxis.set_major_formatter(mdates.DateFormatter("%b %y"))
frame(b, "", "Chains returning live supply at each observation", SRC)
save(fig, "usdt0-ratio-coverage.svg")

# --- 2. collateral vs liabilities ------------------------------------------
fig, ax = plt.subplots(figsize=(7.2, 3.6))
ax.plot(dates, coll, lw=2.2, color=SKY, solid_capstyle="round")
ax.plot(dates, liab, lw=2.2, color=PERSIMMON, solid_capstyle="round")
ax.annotate("Collateral", xy=(dates[-1], coll[-1]), xytext=(8, 5),
            textcoords="offset points", fontsize=8.5, color=SKY, fontweight="bold")
ax.annotate("Liabilities", xy=(dates[-1], liab[-1]), xytext=(8, -12),
            textcoords="offset points", fontsize=8.5, color=PERSIMMON, fontweight="bold")
ax.axvline(datetime(2025, 8, 27, 18, tzinfo=timezone.utc), color=MUTED, lw=1, ls=(0, (3, 3)))
ax.annotate("27 Aug 2025: +$1.26bn into the\nlockbox against flat liabilities",
            xy=(datetime(2025, 8, 27, 18, tzinfo=timezone.utc), 1.4),
            xytext=(10, 0), textcoords="offset points", fontsize=7.5, color=MUTED, va="center")
ax.yaxis.set_major_formatter(FuncFormatter(lambda v, _: f"${v:,.0f}bn" if v else "0"))
ax.xaxis.set_major_locator(mdates.MonthLocator(interval=2))
ax.xaxis.set_major_formatter(mdates.DateFormatter("%b %y"))
ax.set_xlim(dates[0], dates[-1] + (dates[-1] - dates[-12]))
ax.set_ylim(0.8, 8.4)
frame(ax, "Collateral steps up to meet liabilities in August 2025",
      "Lockbox collateral vs aggregate cross-chain minted supply", SRC)
save(fig, "usdt0-collateral.svg")

# --- 3. buffer, absolute and proportional ----------------------------------
pd_ = [d for d, m in zip(dates, post) if m]
pg = gap[post]
pl = np.array([float(r["liabilities"]) for r, m in zip(rows, post) if m]) / 1e6
prel = pg / pl * 100
fig, (a, b) = plt.subplots(2, 1, figsize=(7.2, 5.0), sharex=True,
                           gridspec_kw={"hspace": 0.42})
a.fill_between(pd_, 0, pg, color=SKY, alpha=0.14, linewidth=0)
a.plot(pd_, pg, lw=2, color=SKY, solid_capstyle="round")
a.axhline(0, color=MUTED, lw=1)
a.yaxis.set_major_formatter(FuncFormatter(lambda v, _: f"${v:,.0f}m"))
frame(a, "The buffer does not scale with the system",
      "Collateral less measured liabilities, in dollars")
b.fill_between(pd_, 0, prel, color=PERSIMMON, alpha=0.16, linewidth=0)
b.plot(pd_, prel, lw=2, color=PERSIMMON, solid_capstyle="round")
b.axhline(0, color=MUTED, lw=1)
ip = int(np.argmin(prel))
b.plot([pd_[ip]], [prel[ip]], "o", ms=6.5, color=SKY, zorder=5,
       markeredgecolor="white", markeredgewidth=1.6)
b.annotate(f"thinnest proportionally: {prel[ip]:.2f}%\nwhen the system was largest",
           xy=(pd_[ip], prel[ip]), xytext=(22, 26), textcoords="offset points",
           fontsize=7.5, color=INK,
           arrowprops=dict(arrowstyle="-", color=MUTED, lw=0.9))
b.yaxis.set_major_formatter(FuncFormatter(lambda v, _: f"{v:.0f}%"))
b.xaxis.set_major_locator(mdates.MonthLocator(interval=2))
b.xaxis.set_major_formatter(mdates.DateFormatter("%b %y"))
frame(b, "", "Same buffer as a share of measured liabilities", SRC)
save(fig, "usdt0-buffer.svg")

# --- 4. participation collapse (paper 2) -----------------------------------
mc = json.load(open(os.path.join(DATA, "tullock_mc.json")))
sig = [r["sigma"] for r in mc["results"]]
act = [r["active"] for r in mc["results"]]
sur = [r["farmer_surplus"] for r in mc["results"]]
x = np.arange(len(sig))
fig, (a, b) = plt.subplots(1, 2, figsize=(7.2, 3.4), gridspec_kw={"wspace": 0.32})
med = [v[0] for v in act]
err = [[v[0] - v[1] for v in act], [v[2] - v[0] for v in act]]
a.bar(x, med, width=0.62, color=SKY)
a.errorbar(x, med, yerr=err, fmt="none", ecolor=INK, elinewidth=1.2, capsize=4)
for i, v in enumerate(act):
    a.annotate(f"{v[0]:.0f}", xy=(i, v[2]), xytext=(0, 5), textcoords="offset points",
               ha="center", fontsize=9, color=INK, fontweight="bold")
a.set_xticks(x); a.set_xticklabels([str(v) for v in sig])
a.set_ylim(0, 28); a.set_yticks([0, 10, 20])
a.set_xlabel("cost dispersion σ", fontsize=8.5, color=MUTED)
a.set_title("Active operators, of 5,000 potential", loc="left", fontsize=9, color=INK)
a.grid(axis="x", visible=False)
meds = [v[0] * 100 for v in sur]
errs = [[(v[0] - v[1]) * 100 for v in sur], [(v[2] - v[0]) * 100 for v in sur]]
b.bar(x, meds, width=0.62, color=PERSIMMON)
b.errorbar(x, meds, yerr=errs, fmt="none", ecolor=INK, elinewidth=1.2, capsize=4)
for i, v in enumerate(sur):
    b.annotate(f"{v[0]*100:.0f}%", xy=(i, v[2] * 100), xytext=(0, 5),
               textcoords="offset points", ha="center", fontsize=9,
               color=INK, fontweight="bold")
b.set_xticks(x); b.set_xticklabels([str(v) for v in sig])
b.set_ylim(0, 58); b.set_yticks([0, 20, 40])
b.yaxis.set_major_formatter(FuncFormatter(lambda v, _: f"{v:.0f}%"))
b.set_xlabel("cost dispersion σ", fontsize=8.5, color=MUTED)
b.set_title("Modeled participant surplus", loc="left", fontsize=9, color=INK)
b.grid(axis="x", visible=False)
fig.suptitle("Model benchmark: cost dispersion compresses the active set",
             x=0.005, y=1.06, ha="left", fontsize=11.5, color=INK, fontweight="semibold")
fig.text(0.005, -0.16, "Model output, not an empirical forecast · medians of 500 draws; whiskers span the 5th–95th percentile.\n"
         "Suwappu Research · closed-form equilibrium, n=5,000 potential entrants · active-set description rejected in Paper 3",
         fontsize=7, color=MUTED, ha="left", alpha=0.85)
save(fig, "points-participation.svg")

# --- 5. denomination --------------------------------------------------------
res = json.load(open(os.path.join(DATA, "tullock_results.json")))
p5 = res["P5_revenue_capture"]
labels = ["Volume-\ndenominated", "Mixed", "Fee-denominated\n(low external cost)", "Fee-denominated\n(very low external cost)"]
rev = [r["protocol_revenue"] / 1e3 for r in p5]
dead = [r["deadweight"] / 1e3 for r in p5]
fig, ax = plt.subplots(figsize=(7.2, 3.4))
x = np.arange(len(labels))
ax.bar(x, rev, 0.6, color=SKY)
ax.bar(x, dead, 0.6, bottom=rev, color=LINE)
for i, (r_, d_) in enumerate(zip(rev, dead)):
    ax.annotate(f"${r_:,.0f}k", xy=(i, r_ / 2), ha="center", va="center",
                fontsize=8.5, color="white", fontweight="bold")
ax.annotate("kept by the protocol", xy=(0, rev[0]), xytext=(14, 26),
            textcoords="offset points", fontsize=7.5, color=SKY, fontweight="bold")
ax.annotate("modeled third-party friction", xy=(0, rev[0] + dead[0] * 0.6),
            xytext=(14, 6), textcoords="offset points", fontsize=7.5, color=MUTED)
ax.set_xticks(x); ax.set_xticklabels(labels, fontsize=8)
ax.yaxis.set_major_formatter(FuncFormatter(lambda v, _: f"${v:,.0f}k"))
frame(ax, "Model identity: denomination changes the destination of spend",
      "Conditional scenario: $990k modeled dissipation on a $1m pool (n=100)",
      "Suwappu Research · scenario output, not measured or forecast revenue; see Paper 2 for assumptions")
save(fig, "points-denomination.svg")

# --- 6. v3: the published artifact vs the corrected series ------------------
pred = json.load(open(os.path.join(DATA, "polygon_predicate_prebreak.json")))["balances_usd"]
corr_ratio = []
for r in rows:
    c = float(r["collateral"])
    l = float(r["liabilities"])
    p = pred.get(r["date"], 0.0)  # predicate counted pre-migration only
    corr_ratio.append((c + (p if r["date"] <= "2025-08-25" else 0.0)) / l)
corr_ratio = np.array(corr_ratio)
pre = ~post
fig, ax = plt.subplots(figsize=(7.2, 3.9))
ax.axhline(1.0, color=LINE, lw=1)
# the artifact: v2's published series, wrong pre-break, shown as the ghost
ax.plot(np.array(dates)[pre], ratio[pre], color=PERSIMMON, lw=1.4, ls=(0, (3, 2)))
ax.annotate("what we published in v2\n(wrong backing account)",
            xy=(dates[4], ratio[4]), xytext=(-4, 34), textcoords="offset points",
            fontsize=7.5, color=PERSIMMON, fontweight="bold", ha="left", va="bottom")
# the corrected series: continuous, never below par
ax.plot(dates, corr_ratio, color=SKY, lw=1.6)
ax.annotate("corrected: lockbox + canonical Polygon predicate",
            xy=(mdates.date2num(datetime(2026, 2, 20, tzinfo=timezone.utc)), 1.145),
            xycoords="data", fontsize=7.5, color=SKY, fontweight="bold", ha="center")
brk = datetime(2025, 8, 27, tzinfo=timezone.utc)
ax.axvline(brk, color=MUTED, lw=0.8, ls=":")
ax.annotate("27 Aug 2025: issuer migrates\nPolygon backing into the lockbox",
            xy=(brk, 0.62), xytext=(8, 0), textcoords="offset points",
            fontsize=7.5, color=MUTED, va="center")
ax.set_ylim(0.45, 1.25)
ax.xaxis.set_major_locator(mdates.MonthLocator(interval=2))
ax.xaxis.set_major_formatter(mdates.DateFormatter("%b %y"))
frame(ax, "The under-collateralization was our artifact, not the system's",
      "USDT0 collateralization ratio; v2 as published (dashed) vs corrected accounting (solid)",
      "Suwappu Research · lockbox + Polygon PoS predicate 0x40ec5B33, archive eth_call at aligned blocks")
save(fig, "usdt0-corrected-series.svg")

# --- 7. p3: observed Lorenz curves vs the model ----------------------------
conc = json.load(open(os.path.join(DATA, "airdrops", "concentration.json")))
fig, ax = plt.subplots(figsize=(7.2, 4.2))
ax.plot([0, 1], [0, 1], color=LINE, lw=1)
ax.annotate("perfect equality", xy=(0.52, 0.545), fontsize=7, color=MUTED, rotation=38)
hy = np.array(conc["HYPE genesis"]["stats"]["lorenz"])
ei = np.array(conc["EIGEN Season 1"]["stats_bonus_adjusted"]["lorenz"])
en = np.array(conc["ENA Season 1"]["stats"]["lorenz"])
ax.plot(hy[:, 0], hy[:, 1], color=SKY, lw=1.7)
ax.plot(ei[:, 0], ei[:, 1], color=PERSIMMON, lw=1.7)
ax.plot(en[:, 0], en[:, 1], color=MUTED, lw=1.4, alpha=0.9)
ax.annotate("ENA S1 (Gini 0.904)", xy=(0.38, 0.145), fontsize=7.5,
            color=MUTED, fontweight="bold")
ax.annotate("HYPE genesis (Gini 0.947)", xy=(0.68, 0.10), fontsize=8,
            color=SKY, fontweight="bold")
ax.annotate("EIGEN S1 both phases, bonus-adjusted (Gini 0.943)", xy=(0.26, 0.062), fontsize=8,
            color=PERSIMMON, fontweight="bold")
# Selected model benchmark at sigma=0.2: the positive-effort set is tiny relative
# to the matched wallet population, so its Lorenz curve hugs the floor until the
# last sliver. This is a benchmark shape, not an entity-level ownership claim.
ax.plot([0, 0.9995, 1], [0, 0, 1], color=INK, lw=1.4, ls=(0, (3, 2)))
ax.annotate("Tullock model benchmark, σ=0.2\n(~20 modeled active wallets)",
            xy=(0.985, 0.20), fontsize=7.5, color=INK, ha="right", fontweight="bold")
ax.set_xlabel("share of recipient wallets (poorest first)")
ax.set_ylabel("share of allocation")
ax.set_xlim(0, 1)
ax.set_ylim(0, 1)
frame(ax, "Observed wallet vectors reject the model's tiny active-set shape",
      "Lorenz curves: HYPE genesis, EIGEN claims (bonus-adjusted), ENA claims, and a selected model benchmark",
      "Suwappu Research · wallet-level measurement; EIGEN/ENA are claim-recipient vectors · wallets are not beneficial owners")
save(fig, "airdrop-lorenz.svg")

print("done")
