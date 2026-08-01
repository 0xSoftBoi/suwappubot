#!/usr/bin/env python3
"""
Statistical robustness for the USDT0 collateralization panel.

The headline series is a 48-hourly ratio of collateral to measured liabilities.
It is serially correlated, so ordinary standard errors and a raw standard
deviation overstate precision. This script:

  1. Tests the ratio series for serial correlation (AR(1), Ljung-Box).
  2. Locates the structural break by exhaustive least-squares changepoint
     search rather than by inspection, and tests it with a sup-Wald
     (Quandt-Andrews) statistic whose null distribution is obtained by a
     stationary block bootstrap -- appropriate because the break date is
     estimated, not assumed, and the data are autocorrelated.
  3. Re-estimates the post-break mean ratio with HAC (Newey-West) standard
     errors and reports the autocorrelation-adjusted effective sample size.
  4. Tests whether the post-break ratio is significantly above 1.0.
  5. Tests the post-break series for a unit root (ADF).
  6. Reports the coverage threshold: how much unmeasured supply would be
     required to overturn the full-backing conclusion.

Output: data/robustness.json, printed summary.
"""
import csv, json, os
import numpy as np
from scipy import stats
import statsmodels.api as sm
from statsmodels.stats.diagnostic import acorr_ljungbox
from statsmodels.tsa.stattools import adfuller, acf

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DATA = os.path.join(ROOT, "data")
RNG = np.random.default_rng(20260726)

rows = list(csv.DictReader(open(os.path.join(DATA, "usdt0_timeseries.csv"))))
dates = [r["date"] for r in rows]
ratio = np.array([float(r["ratio"]) for r in rows])
gap = np.array([float(r["gap"]) for r in rows])
liab = np.array([float(r["liabilities"]) for r in rows])
n = len(ratio)
OUT = {"n_observations": n, "date_range": [dates[0], dates[-1]]}


# ---------------------------------------------------------------- 1. serial correlation
def ar1(x):
    x = np.asarray(x, float)
    return float(np.corrcoef(x[:-1], x[1:])[0, 1])


post_idx = np.array([d >= "2025-08-30" for d in dates])
post = ratio[post_idx]

lb = acorr_ljungbox(post - post.mean(), lags=[1, 5, 10], return_df=True)
OUT["serial_correlation"] = {
    "ar1_full_sample": ar1(ratio),
    "ar1_post_break": ar1(post),
    "ljung_box_post_break": {
        f"lag_{int(l)}": {"stat": float(s), "pvalue": float(p)}
        for l, s, p in zip(lb.index, lb["lb_stat"], lb["lb_pvalue"])
    },
}

# ---------------------------------------------------------------- 2. changepoint
def sse_two_means(x, k):
    """Residual sum of squares for a single mean shift at index k."""
    a, b = x[:k], x[k:]
    return float(((a - a.mean()) ** 2).sum() + ((b - b.mean()) ** 2).sum())


def best_break(x, trim=0.05):
    lo, hi = max(2, int(trim * len(x))), min(len(x) - 2, int((1 - trim) * len(x)))
    ks = range(lo, hi)
    sses = [sse_two_means(x, k) for k in ks]
    k = list(ks)[int(np.argmin(sses))]
    return k, float(np.min(sses))


def chow_F(x, k):
    """F statistic for a mean shift at a known k."""
    rss_r = float(((x - x.mean()) ** 2).sum())
    rss_u = sse_two_means(x, k)
    p1, p2 = 1, 2
    df1, df2 = p2 - p1, len(x) - p2
    if rss_u <= 0:
        return np.inf
    return float(((rss_r - rss_u) / df1) / (rss_u / df2))


k_hat, _ = best_break(ratio)
F_sup = chow_F(ratio, k_hat)

# Null distribution by stationary block bootstrap: resample the DEMEANED series
# in blocks (preserving autocorrelation) under H0 of no break, re-run the same
# exhaustive search, and record the sup-F each time.
def block_bootstrap(x, block, rng):
    out, m = [], len(x)
    while len(out) < m:
        s = rng.integers(0, m)
        out.extend(x[i % m] for i in range(s, s + block))
    return np.array(out[:m])


resid = ratio - ratio.mean()
BLOCK = max(2, int(round(2 * (1 + ar1(ratio)) / max(1e-9, 1 - ar1(ratio)))))
BLOCK = min(BLOCK, n // 4)
B = 2000
null_sup = np.empty(B)
for b in range(B):
    xb = block_bootstrap(resid, BLOCK, RNG)
    kb, _ = best_break(xb)
    null_sup[b] = chow_F(xb, kb)
p_sup = float((null_sup >= F_sup).mean())

OUT["structural_break"] = {
    "method": "exhaustive least-squares single-mean-shift search, 5% trimming",
    "estimated_break_index": int(k_hat),
    "last_obs_before_break": dates[k_hat - 1],
    "first_obs_after_break": dates[k_hat],
    "sup_F_statistic": F_sup,
    "bootstrap": {
        "null": "stationary block bootstrap of the demeaned series, no break",
        "block_length": int(BLOCK),
        "replications": B,
        "p_value": p_sup,
        "null_sup_F_p95": float(np.percentile(null_sup, 95)),
        "null_sup_F_max": float(null_sup.max()),
    },
}

# ---------------------------------------------------------------- 3. HAC mean
X = np.ones((len(post), 1))
maxlags = int(np.floor(4 * (len(post) / 100) ** (2 / 9)))  # Newey-West rule of thumb
ols = sm.OLS(post, X).fit(cov_type="HAC", cov_kwds={"maxlags": maxlags, "use_correction": True})
mean_hat = float(ols.params[0])
se_hac = float(ols.bse[0])
se_iid = float(post.std(ddof=1) / np.sqrt(len(post)))
rho = ar1(post)
n_eff = len(post) * (1 - rho) / (1 + rho) if rho < 1 else float("nan")

OUT["post_break_mean"] = {
    "n": int(len(post)),
    "mean": mean_hat,
    "median": float(np.median(post)),
    "min": float(post.min()),
    "max": float(post.max()),
    "sd_raw": float(post.std(ddof=1)),
    "se_iid_naive": se_iid,
    "se_newey_west": se_hac,
    "newey_west_maxlags": maxlags,
    "se_inflation_vs_iid": se_hac / se_iid,
    "effective_sample_size": float(n_eff),
    "ci95_hac": [mean_hat - 1.96 * se_hac, mean_hat + 1.96 * se_hac],
}

# ---------------------------------------------------------------- 4. is ratio > 1?
t_stat = (mean_hat - 1.0) / se_hac
p_one_sided = float(1 - stats.norm.cdf(t_stat))
OUT["test_ratio_above_one"] = {
    "null": "mean post-break ratio = 1.0",
    "alternative": "> 1.0",
    "t_statistic_hac": float(t_stat),
    "p_value_one_sided": p_one_sided,
}

# ---------------------------------------------------------------- 5. stationarity
adf_stat, adf_p, adf_lag, adf_nobs, adf_crit, _ = adfuller(post, autolag="AIC")
OUT["stationarity_post_break"] = {
    "test": "augmented Dickey-Fuller",
    "statistic": float(adf_stat), "pvalue": float(adf_p),
    "lags_used": int(adf_lag),
    "critical_values": {k: float(v) for k, v in adf_crit.items()},
}

# ---------------------------------------------------------------- 6. coverage threshold
post_gap, post_liab = gap[post_idx], liab[post_idx]
OUT["coverage_threshold"] = {
    "definition": "unmeasured liabilities that would drive the observation below 1.0",
    "min_usd": float(post_gap.min()),
    "median_usd": float(np.median(post_gap)),
    "min_pct_of_measured": float((post_gap / post_liab).min() * 100),
    "median_pct_of_measured": float(np.median(post_gap / post_liab) * 100),
    "share_of_obs_flipped_if_unmeasured_is_50m": float((post_gap < 50e6).mean()),
    "share_of_obs_flipped_if_unmeasured_is_100m": float((post_gap < 100e6).mean()),
    "share_of_obs_flipped_if_unmeasured_is_200m": float((post_gap < 200e6).mean()),
}

json.dump(OUT, open(os.path.join(DATA, "robustness.json"), "w"), indent=2)

# ---------------------------------------------------------------- report
s = OUT
print("SERIAL CORRELATION")
print(f"  AR(1) full sample      {s['serial_correlation']['ar1_full_sample']:.3f}")
print(f"  AR(1) post-break       {s['serial_correlation']['ar1_post_break']:.3f}")
for k, v in s["serial_correlation"]["ljung_box_post_break"].items():
    print(f"  Ljung-Box {k:6s}       stat={v['stat']:8.2f}  p={v['pvalue']:.3g}")

b = s["structural_break"]
print("\nSTRUCTURAL BREAK (estimated, not assumed)")
print(f"  break between          {b['last_obs_before_break']} and {b['first_obs_after_break']}")
print(f"  sup-F                  {b['sup_F_statistic']:,.1f}")
print(f"  block bootstrap p      {b['bootstrap']['p_value']:.4f}  "
      f"(block={b['bootstrap']['block_length']}, B={b['bootstrap']['replications']})")
print(f"  null sup-F 95th pct    {b['bootstrap']['null_sup_F_p95']:.1f}   max {b['bootstrap']['null_sup_F_max']:.1f}")

m = s["post_break_mean"]
print("\nPOST-BREAK MEAN RATIO, AUTOCORRELATION-ADJUSTED")
print(f"  mean                   {m['mean']:.4f}")
print(f"  sd (raw)               {m['sd_raw']:.4f}   <- not an iid dispersion measure")
print(f"  SE iid (naive)         {m['se_iid_naive']:.5f}")
print(f"  SE Newey-West          {m['se_newey_west']:.5f}   ({m['se_inflation_vs_iid']:.2f}x the naive SE)")
print(f"  effective sample size  {m['effective_sample_size']:.1f} of {m['n']}")
print(f"  95% CI (HAC)           [{m['ci95_hac'][0]:.4f}, {m['ci95_hac'][1]:.4f}]")

t = s["test_ratio_above_one"]
print(f"\nH0: mean ratio = 1.0 vs > 1.0   t(HAC)={t['t_statistic_hac']:.1f}  p={t['p_value_one_sided']:.3g}")
a = s["stationarity_post_break"]
print(f"ADF on post-break ratio         stat={a['statistic']:.2f}  p={a['pvalue']:.4f}  "
      f"(5% crit {a['critical_values']['5%']:.2f})")
c = s["coverage_threshold"]
print(f"\nCOVERAGE THRESHOLD  min ${c['min_usd']/1e6:.1f}m ({c['min_pct_of_measured']:.2f}% of measured), "
      f"median ${c['median_usd']/1e6:.1f}m ({c['median_pct_of_measured']:.2f}%)")
print("wrote data/robustness.json")
