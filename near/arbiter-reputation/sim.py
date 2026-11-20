#!/usr/bin/env python3
"""Attack-cost simulation: how much does it cost to reach a top-decile reputation under three scoring rules?

  python3 -I sim.py            (stdlib only, deterministic seeds)

Scoring rules for a provider:
  count   = number of attested deliveries                  (the naive "Tier 2" plan)
  volume  = sum of attested escrow amounts                 (what a payment-volume ranking does)
  flow    = max-flow from trusted seeds (flowrep.py)       (Sybil-bounded)

Attacker model (strongest cheap one): controls unlimited fresh accounts, can run Arbiter escrows between them
at FAKE_COST NEAR each (resolve fee + retained storage deposit + gas; the escrow principal is recycled to the
attacker's own worker). With budget b NEAR the attacker either farms attestations (naive rules) or, against the
flow rule, spends b as a REAL payment to the best-connected honest provider to build a bridge, then wash-trades
1000-NEAR escrows from the sybil side to the target.

HONEST LIMITS: the honest graph is synthetic (parameters below), the cost per fake attestation is an estimate
calibrated on arb2 (storage deposit measured 0.0082 NEAR; resolve fee ~0.0041 NEAR per contract comment; gas
estimated). Results are about the SCORING RULES, not a forecast of the real market.
"""
import math, random, statistics
from flowrep import ratings

FAKE_COST = 0.0165  # NEAR per fake attestation: 0.0082 storage (measured) + 0.0041 fee + ~0.004 gas (est.)
N_BUYERS, N_PROVIDERS, N_SEEDS = 300, 120, 10
RUBRIC = "github_pr_v1"


def honest_graph(rng):
    buyers = [f"b{i}" for i in range(N_BUYERS)]
    provs = [f"p{i}" for i in range(N_PROVIDERS)]
    seeds = buyers[:N_SEEDS]
    deg = {p: 1 for p in provs}
    edges = []
    for b in buyers:
        for _ in range(1 + int(rng.expovariate(1 / 2.5))):  # ~3.5 hires per buyer
            p = rng.choices(provs, weights=[deg[x] for x in provs])[0]  # preferential attachment
            deg[p] += 1
            edges.append({"buyer": b, "worker": p, "amount": rng.lognormvariate(0, 1), "rubric": RUBRIC})
    for p in provs:  # a fifth of providers also hire other providers (agents hiring agents)
        if rng.random() < 0.2:
            q = rng.choices(provs, weights=[deg[x] for x in provs])[0]
            if q != p:
                deg[q] += 1
                edges.append({"buyer": p, "worker": q, "amount": rng.lognormvariate(0, 1), "rubric": RUBRIC})
    return seeds, provs, edges


def metrics(edges, provs):
    cnt = {p: 0 for p in provs}
    vol = {p: 0.0 for p in provs}
    for e in edges:
        if e["worker"] in cnt:
            cnt[e["worker"]] += 1
            vol[e["worker"]] += e["amount"]
    return cnt, vol


def pct(val, dist):
    return 100.0 * sum(1 for x in dist if x <= val) / len(dist)


def trial(seed, budgets):
    rng = random.Random(seed)
    seeds, provs, edges = honest_graph(rng)
    cnt, vol = metrics(edges, provs)
    flow = ratings(edges, seeds, provs)
    # best-connected honest provider = the attacker's best bridge target
    bridge_to = max(provs, key=lambda p: flow[p])
    out = []
    for b in budgets:
        m = int(b / FAKE_COST)  # fake attestations the budget buys under naive rules
        c_att = pct(m, list(cnt.values()))
        v_att = pct(m * 1000.0, list(vol.values()))  # wash escrows of 1000 NEAR, principal recycled
        # flow attacker: budget b is a REAL payment sybil->bridge_to; 20 wash escrows of 1000 NEAR to the target
        # EDGE_CAP applies per escrow, so the attacker splits the bridge payment into capped escrows (strongest play)
        n_split = max(1, math.ceil(b / 10.0))
        atk = edges + [{"buyer": "sybil0", "worker": bridge_to, "amount": b / n_split, "rubric": RUBRIC} for _ in range(n_split)]
        atk += [{"buyer": f"sybil{i}", "worker": "target", "amount": 1000.0, "rubric": RUBRIC} for i in range(1, 21)]
        # the bridge account also wash-trades to the target with many capped escrows (else this edge, not the bridge, binds)
        atk += [{"buyer": "sybil0", "worker": "target", "amount": 1000.0, "rubric": RUBRIC} for _ in range(40)]
        r = ratings(atk, seeds, ["target"])["target"]
        f_att = pct(r, list(flow.values()))
        out.append((b, c_att, v_att, f_att, r))
    # pure island: no real bridge at all
    isl = edges + [{"buyer": f"sybil{i}", "worker": "target", "amount": 1000.0, "rubric": RUBRIC} for i in range(500)]
    island = ratings(isl, seeds, ["target"])["target"]
    top10 = sorted(flow.values())[int(0.9 * len(provs))]
    zero = sum(1 for v in flow.values() if v == 0) / len(provs)  # honest providers the rule cannot rate (cold start)
    return out, island, top10, sorted(cnt.values())[int(0.9 * len(provs))], sorted(vol.values())[int(0.9 * len(provs))], zero


def main():
    budgets = [0.05, 0.5, 5, 50]
    trials = [trial(s, budgets) for s in range(15)]
    print(f"honest graph: {N_BUYERS} buyers, {N_PROVIDERS} providers, {N_SEEDS} trusted seeds; 15 random graphs (medians)")
    print(f"fake attestation cost = {FAKE_COST} NEAR (storage 0.0082 measured + fee 0.0041 + gas ~0.004 est.)\n")
    t10 = statistics.median(t[2] for t in trials)
    print(f"top-decile thresholds (medians): count={statistics.median(t[3] for t in trials):.0f} attestations, "
          f"volume={statistics.median(t[4] for t in trials):.1f} NEAR, flow={t10:.2f} NEAR")
    print(f"cost to hit top-decile COUNT  = {statistics.median(t[3] for t in trials) * FAKE_COST:.3f} NEAR (all wash fees)")
    print(f"cost to hit top-decile VOLUME = {FAKE_COST:.3f} NEAR (one 1000-NEAR wash escrow; principal recycled)")
    print(f"cost to hit top-decile FLOW   >= {t10:.2f} NEAR of REAL payment to honest providers (bridge bound)\n")
    print("attacker budget (NEAR) | percentile reached: count | volume | flow  | flow rating (NEAR)")
    for i, b in enumerate(budgets):
        row = [t[0][i] for t in trials]
        print(f"{b:>22} | {statistics.median(r[1] for r in row):>25.0f} | {statistics.median(r[2] for r in row):>6.0f} | "
              f"{statistics.median(r[3] for r in row):>5.0f} | {statistics.median(r[4] for r in row):.3f}")
    print(f"\ncost of the rule: {100 * statistics.median(t[5] for t in trials):.0f}% of HONEST providers get flow rating 0 "
          f"(no path from the seeds) - the cold-start price of Sybil resistance")
    print(f"pure island, 500 wash attestations of 1000 NEAR each, ZERO real bridge: flow rating = "
          f"{max(t[1] for t in trials) / 1:.3f} NEAR (max over graphs)")
    # sanity: rating gain <= bridge payment, across all trials/budgets
    worst = max(r[4] - r[0] for t in trials for r in t[0])
    print(f"max (flow rating - bridge payment) over all trials = {worst:.4f} NEAR  (<= 0 means the bound held)")


main()
