#!/usr/bin/env python3
"""Concentration analysis of completed airdrop allocations vs the Tullock
active-set prediction (Paper 3).

For each collected program (data/airdrops/*_recipients.json):
  - top-k shares (k = 1, 10, 100, 1000), top-1% share, Gini, HHI and its
    equal-holder equivalent, and a 100-point Lorenz curve for exhibits.
  - EIGEN additionally gets a bonus-adjusted vector (minus the flat 100
    EIGEN per claimer, floor 0) to isolate the pro-rata component.

Model bridge: under Paper 2's model (lognormal marginal costs, sigma in
0.2..1.0, 5,000 potential entrants) the MEDIAN top-1 share of the pool is
17.1%..40.8%. Here we ask the reverse question at each program's own scale:
what sigma would the model need to reproduce the observed top-1 share, and
what active-set size does the model then imply? If no sigma jointly matches
(top-1, participation), the active-set channel is rejected at wallet level.

Wallet-level caveat, everywhere: wallet and beneficial-owner concentration are
different objects. Splitting one entity across wallets can make entity concentration
higher than the wallet measure; omnibus or custodial wallets can move the measurement
in the opposite direction. The sign is not identified without entity resolution.

Writes data/airdrops/concentration.json
"""
import glob
import json
import os

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
AIRDIR = os.path.join(HERE, "..", "data", "airdrops")
SEED = 20260731


def stats(values):
    v = np.sort(np.asarray(values, float))[::-1]
    v = v[v > 0]
    n = len(v)
    tot = v.sum()
    shares = v / tot
    out = {
        "n_recipients": int(n),
        "pool_total": float(tot),
        "top1_share": float(shares[0]),
        "top10_share": float(shares[:10].sum()),
        "top100_share": float(shares[:100].sum()),
        "top1000_share": float(shares[:1000].sum()) if n >= 1000 else None,
        "top1pct_share": float(shares[: max(1, n // 100)].sum()),
        "hhi": float((shares**2).sum()),
        "median": float(np.median(v)),
        "mean": float(v.mean()),
    }
    out["equal_holder_equivalent"] = 1.0 / out["hhi"]
    asc = v[::-1]
    cum = np.cumsum(asc)
    out["gini"] = float(1 - 2 * (cum.sum() / (n * tot)) + 1 / n)
    # 100-point Lorenz curve: population share -> cumulative allocation share
    q = np.linspace(0.01, 1.0, 100)
    idx = np.clip((q * n).astype(int) - 1, 0, n - 1)
    out["lorenz"] = [[float(qi), float(cum[i] / tot)] for qi, i in zip(q, idx)]
    return out


# ---------------------------------------------------------- model bridge ----
def exact_equilibrium_shares(costs, V=1.0):
    """Active-set equilibrium of the asymmetric Tullock contest (Stein 2002).
    Returns per-player effort shares (= pool shares) for active players."""
    c = np.sort(np.asarray(costs, float))
    best = None
    for m in range(2, len(c) + 1):
        C = c[:m].sum()
        S = V * (m - 1) / C
        if c[m - 1] < V / S:
            best = (m, S)
        elif best:
            break
    m, S = best
    x = S * (1 - c[:m] * S / V)
    return x / x.sum()


def model_top1_and_active(sigma, n_potential, draws=25, rng=None):
    rng = rng or np.random.default_rng(SEED)
    t1, act = [], []
    for _ in range(draws):
        costs = np.exp(rng.normal(0, sigma, n_potential))
        sh = exact_equilibrium_shares(costs)
        t1.append(sh.max())
        act.append(len(sh))
    return float(np.median(t1)), float(np.median(act))


def joint_rejection_test(observed_top1, observed_n, n_potential,
                         draws=200, rng=None):
    """Finite-grid simulation test of the active-set model's joint wallet-level fit.

    For each sigma on a prespecified log-spaced grid from 1e-4 through 1.2,
    draw `draws` economies and count draws in which the model
    simultaneously produces (a) a top-1 share within a factor of two of the
    observed one AND (b) an active set of at least half the observed recipient
    count. Generous windows, both moments required. A zero count at every tested
    sigma is reported as a rejection over this model/grid, not as proof over a
    continuous parameter space or over alternative behavioral models. With zero
    hits, 1/draws is reported as simulation resolution, not a confidence bound.

    The two moments trade off monotonically in sigma (small sigma: broad
    participation but near-uniform shares; large sigma: matched-or-higher
    top-1 but a tiny active set), which is why the joint test is the right
    object and either marginal test alone would be rigged.
    """
    rng = rng or np.random.default_rng(SEED)
    grid = np.exp(np.linspace(np.log(1e-4), np.log(1.2), 15))
    per_sigma = []
    for sigma in grid:
        hits = 0
        t1s, acts = [], []
        for _ in range(draws):
            sh = exact_equilibrium_shares(np.exp(rng.normal(0, sigma, n_potential)))
            t1, act = sh.max(), len(sh)
            t1s.append(t1)
            acts.append(act)
            if observed_top1 / 2 <= t1 <= observed_top1 * 2 and act >= observed_n / 2:
                hits += 1
        per_sigma.append({
            "sigma": round(float(sigma), 6),
            "hits": hits,
            "median_top1": float(np.median(t1s)),
            "median_active": float(np.median(acts)),
        })
    total_hits = sum(p["hits"] for p in per_sigma)
    max_grid_hits = max(p["hits"] for p in per_sigma)
    return {
        "windows": "top1 in [obs/2, 2*obs] AND active >= obs/2",
        "draws_per_sigma": draws,
        "sigma_grid": [p["sigma"] for p in per_sigma],
        "per_sigma": per_sigma,
        "total_joint_hits": total_hits,
        # Legacy field name retained for compatibility. This is the maximum hit
        # rate over the finite sigma grid; with zero hits it records Monte Carlo
        # resolution (1/draws), not a continuous-space statistical upper bound.
        "sup_p_bound": (max_grid_hits / draws) if max_grid_hits else 1.0 / draws,
    }


def backout_sigma(observed_top1, n_potential):
    """Bisect sigma so the model's median top-1 share matches the observed one.
    Returns (sigma, model_active_at_sigma)."""
    lo, hi = 1e-3, 1.5
    rng = np.random.default_rng(SEED)
    for _ in range(18):
        mid = (lo + hi) / 2
        t1, _ = model_top1_and_active(mid, n_potential, draws=15, rng=rng)
        if t1 > observed_top1:
            hi = mid
        else:
            lo = mid
    sigma = (lo + hi) / 2
    t1, act = model_top1_and_active(sigma, n_potential, draws=25)
    return sigma, t1, act


if __name__ == "__main__":
    results = {}
    for path in sorted(glob.glob(os.path.join(AIRDIR, "*_recipients.json"))):
        d = json.load(open(path))
        name = d["program"]
        vec = list(d["recipients"].values())
        r = {"kind": d["kind"], "stats": stats(vec)}
        if "EIGEN" in name:
            adj = [max(0.0, x - 100.0) for x in vec]
            r["stats_bonus_adjusted"] = stats(adj)
        # Model bridge at this program's own entrant count.
        s = r["stats"]
        sigma, model_t1, model_active = backout_sigma(s["top1_share"], s["n_recipients"])
        r["model_bridge"] = {
            "note": ("sigma at which the Tullock model's median top-1 share matches the "
                     "observed one, holding n_potential = observed recipients; "
                     "model_active is the active-set size the model then implies."),
            "observed_top1": s["top1_share"],
            "backed_out_sigma": round(sigma, 4),
            "model_top1_at_sigma": model_t1,
            "model_active_at_sigma": model_active,
            "paper2_predicted_top1_band": [0.171, 0.408],
            "paper2_predicted_active_band": [5, 18],
        }
        # Matched-n band: the model's predictions at THIS program's entrant
        # count, so the comparison cannot be attacked as an n=5,000 artifact.
        rngm = np.random.default_rng(SEED)
        band = {}
        for sig in (0.2, 0.4, 1.0):
            t1s, t10s, acts = [], [], []
            for _ in range(30):
                sh = exact_equilibrium_shares(np.exp(rngm.normal(0, sig, s["n_recipients"])))
                srt = np.sort(sh)[::-1]
                t1s.append(srt[0])
                t10s.append(srt[:10].sum())
                acts.append(len(srt))
            band[str(sig)] = {
                "median_top1": float(np.median(t1s)),
                "median_top10": float(np.median(t10s)),
                "median_active": float(np.median(acts)),
            }
        r["model_band_matched_n"] = band
        r["joint_rejection"] = joint_rejection_test(
            s["top1_share"], s["n_recipients"], s["n_recipients"])
        results[name] = r
        print(f"{name}: n={s['n_recipients']:,} top1={s['top1_share']*100:.3f}% "
              f"top1%={s['top1pct_share']*100:.1f}% gini={s['gini']:.4f} "
              f"| model needs sigma={sigma:.3f} -> active={model_active:.0f}")
    out = os.path.join(AIRDIR, "concentration.json")
    json.dump(results, open(out, "w"), indent=1)
    print(f"wrote {out}")
