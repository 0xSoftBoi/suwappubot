# Suwappu Research — replication bundle

Code, data and full working papers for the three research papers published at
<https://suwappu.bot/research>. Everything here is the material the papers cite.
Nothing in this bundle requires credentials: the chain reads use public RPC
endpoints, and the simulation runs offline.

First published 26 July 2026; expanded 31 July 2026. Author: Tsolmondorj Natsagdorj (0xSoftBoi), Suwappu Research.

---

## Papers

| File | Paper |
|---|---|
| `papers/usdt0-collateral-reconciliation.md` | *Measuring Collateral Backing of an Omnichain Dollar: A Point-in-Time Reconciliation of USDT0 Across 17 Chains* |
| `papers/points-tullock-contests.md` | *Points Programs as Tullock Contests: Equilibrium Concentration, Denomination, and Sybil Neutrality* |
| `papers/airdrop-concentration.md` | *Who Actually Collected the Airdrops: Testing the Tullock Active-Set Prediction Against Completed Allocations* |

The web posts on suwappu.bot are abridgements. Where an abridgement and a paper
disagree, the paper governs.

---

## Paper 1 — USDT0 collateral reconciliation

### Code

| File | What it does |
|---|---|
| `code/collect_usdt0.py` | Collection harness. Point-in-time block resolution per chain, then direct `eth_call` reads of `totalSupply()` (`0x18160ddd`) and `balanceOf()` (`0x70a08231`). Public RPC only. |
| `code/analyze_usdt0.py` | Ratio series, summary statistics, exhibits. |
| `code/break_scan2.py` | 6-hourly rescan of 2025-08-25 → 2025-09-01. |
| `code/robustness.py` | Serial correlation, changepoint search, stationary block bootstrap, Newey–West HAC inference, ADF, coverage thresholds. |

**The 183-observation panel requires `DAYS=365 STEP_HOURS=48`.** The script
defaults produce a different panel.

```bash
DAYS=365 STEP_HOURS=48 python3 code/collect_usdt0.py
python3 code/analyze_usdt0.py
python3 code/robustness.py
```

### Data

| File | Contents |
|---|---|
| `data/usdt0_panel.csv` | 3,843 raw entity-date observations across 21 measured entities, with per-cell status. |
| `data/usdt0_timeseries.csv` | 183 aligned rows, per-chain supply columns, collateral, ratio, escrow controls. |
| `data/usdt0_break.csv` | 6-hourly bracketing panel around the August 2025 event. |
| `data/usdt0_summary.json` | Computed summary statistics (Tables 1, 3, 5). |
| `data/robustness.json` | All Section 4 statistics. |
| `data/usdt0_panel_v1_12chain.csv` | **The superseded 12-chain panel**, retained so the correction in Section 1 can be checked directly rather than taken on trust. |
| `data/universe_table.md` | Documented deployment set versus measured set. |

### Known limits, stated in the paper

- Tron, TON and MegaETH are unmeasured. Measured liabilities are a lower bound,
  so every ratio here is an **upper** bound.
- The panel is unbalanced: chains returning live supply rise from 8 to 17 across
  the sample, which biases early observations upward. The level of the ratio is
  not comparable across time.
- The not-deployed label is not verified by an `eth_getCode` check, so
  archive-depth failure and genuine non-deployment are not distinguished. Both
  are zero-filled and both bias the ratio up.
- Head reads in Table 1 are not block-aligned.

---

## Paper 2 — Points programs as Tullock contests

### Code

| File | What it does |
|---|---|
| `code/tullock_sim.py` | Exact active-set equilibrium solver, cost-invariance and revenue-capture scenarios, sybil tests. |
| `code/tullock_mc.py` | 500-draw Monte Carlo per σ at n = 5,000, plus the sybil-gain sensitivity sweep. |
| `code/verify_equilibrium.py` | Four-check verification suite (FOC residuals, entry conditions, grid search over unilateral deviations, independent damped best-response). |

Seeded with `np.random.default_rng(20260726)`. No network access required; the
numbers are reproducible bit-for-bit.

```bash
python3 code/tullock_sim.py
python3 code/tullock_mc.py
python3 code/verify_equilibrium.py
```

### Data

| File | Contents |
|---|---|
| `data/tullock_results.json` | Propositions 1–4: symmetric equilibrium, cost invariance, heterogeneous active sets, sybil neutrality, revenue capture. |
| `data/tullock_mc.json` | Monte Carlo sampling distributions per σ, and the sybil sensitivity sweep. |
| `data/verify_output.txt` | Raw output of the verification suite. |
| `data/sim_output.txt` | Raw output of the simulation. |

### Known limits, stated in the paper

- **No number here is calibrated against an observed points program.** This is
  the equilibrium of a stated game, with sampling bands — theory, not measurement.
- Checks A, B and D in the verification suite all evaluate or solve the model's
  own first-order condition. Only check C is calculus-free. The suite establishes
  that the solver solves the stated game correctly. It does not establish that
  the game describes reality.
- The model assumes complete information, simultaneous moves, risk neutrality,
  linear costs and no capital constraint. Convex costs and risk aversion both
  push realised concentration below the modelled band.
- Proposition 3 is not new. It restates the standard asymmetric-Tullock
  active-set characterisation; see the paper's Section 1 for attribution.

---

## Paper 3 — Airdrop concentration

### Code

| File | What it does |
|---|---|
| `code/collect_airdrops.py` | Collects the HYPE genesis vector and the EIGEN/ENA distribution logs with checkpointed, range-splitting public-RPC reads. |
| `code/analyze_airdrops.py` | Computes concentration statistics, matched-n model bands, Lorenz curves and the sup-over-σ rejection test. |

### Data

| File | Contents |
|---|---|
| `data/airdrops/hype_genesis_raw.json` | Complete raw HYPE genesis state before the six documented system-account exclusions. |
| `data/airdrops/hype_recipients.json` | 90,912 HYPE recipient wallets used in the primary test. |
| `data/airdrops/eigen_recipients.json` | 239,035 EIGEN Season 1 recipient wallets with both phases merged per wallet. |
| `data/airdrops/ena_recipients.json` | Four ENA claim channels merged over the full scanned horizon. |
| `data/airdrops/concentration.json` | Reported concentration statistics, matched-n bands and joint rejection results. |

### Known limits, stated in the paper

- All concentration measurements are wallet-level, so they are lower bounds on person-level concentration when one entity controls multiple wallets.
- HYPE is a post-enforcement allocation; EIGEN is claims data, so unclaimed allocations are absent; ENA claim executors can aggregate custodially.
- The formal rejection is anchored on HYPE and EIGEN. ENA is a lower-resolution replication of the distributional shape, not the load-bearing datapoint.

---

## Environment

Python 3.12+ with `numpy`, `pandas`, `scipy`, `statsmodels`, `matplotlib`.
Chain reads use the standard library only.

## Licence and citation

Released for verification and reuse. Cite as:

> Natsagdorj, T. (2026). *Measuring Collateral Backing of an Omnichain Dollar:
> A Point-in-Time Reconciliation of USDT0 Across 17 Chains.* Suwappu Research.

> Natsagdorj, T. (2026). *Points Programs as Tullock Contests: Equilibrium
> Concentration, Denomination, and Sybil Neutrality.* Suwappu Research.

> Natsagdorj, T. (2026). *Who Actually Collected the Airdrops: Testing the
> Tullock Active-Set Prediction Against Completed Allocations.* Suwappu Research.

## Disclosures

Suwappu builds cross-chain execution infrastructure spanning several of the
chains measured in Paper 1 and operates a points program of the class analysed
in Paper 2. Full disclosures are in each paper's final section. This is
research, not investment advice.
