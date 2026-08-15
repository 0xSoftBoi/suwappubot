# Suwappu Research — replication bundle

Code, data and full working papers for the five research papers published at
<https://suwappu.bot/research>. Everything here is the material the papers cite.
Nothing in this bundle requires credentials: the chain reads use public RPC
endpoints, and the simulation runs offline.

First published 26 July 2026; Papers 2 and 3 materially revised 8 August 2026; the
ERC-8056 integration study (Paper 4) was published 7 August 2026; the latency calibration
(Paper 5) was published 8 August 2026; report edition published 6 August 2026. Author:
Tsolmondorj Natsagdorj (0xSoftBoi), Suwappu Research.

**Report edition:** [*Accounting for an Omnichain Dollar*](../reports/accounting-for-an-omnichain-dollar.pdf)
packages the USDT0 findings, both corrections, the proof boundary and the replication
path into a nine-page research report. It separates protocol token-unit backing from
USDT issuer, legal, liquidity and prudential questions. The working paper remains canonical.

---

## Papers

| File | Paper |
|---|---|
| `papers/usdt0-collateral-reconciliation.md` | *Measuring Protocol Backing of an Omnichain Dollar: A Point-in-Time USDT0 Token-Unit Reconciliation, Twice Corrected* |
| `papers/points-tullock-contests.md` | *Points-Program Economics After Empirical Rejection: Conditional Tullock Benchmarks for Participation, Dissipation, Fee Denomination, and Wallet Splitting* |
| `papers/airdrop-concentration.md` | *Airdrop Allocation Concentration: A Wallet-Level Field Test of the Tullock Active-Set Model* |
| `papers/erc8056-stock-token-interface-risk.md` | *When balanceOf() Stops Meaning What the User Thinks: ERC-8056 Integration Risk in Robinhood Stock Tokens* |
| `papers/settlement-latency-value.md` | *What Is a Minute of Cross-Chain Execution Worth? Pricing Latency Without Confusing ETA for Finality* |

The web posts on suwappu.bot are abridgements. Where an abridgement and a paper
disagree, the paper governs.

---

## Paper 1 — USDT0 protocol-backing reconciliation

Paper 1 measures one relationship only: USDT token units in canonical USDT0 backing
accounts versus documented direct USDT0 supply. It does not measure Tether's underlying
reserve portfolio, USDT redemption capacity, legal claims, market liquidity, stressed
convertibility or prudential classification.

### Code

| File | What it does |
|---|---|
| `code/collect_usdt0.py` | Collection harness. Point-in-time block resolution per chain, then direct `eth_call` reads of `totalSupply()` (`0x18160ddd`) and `balanceOf()` (`0x70a08231`). Public RPC only. |
| `code/analyze_usdt0.py` | Ratio series, summary statistics, exhibits. |
| `code/break_scan2.py` | 6-hourly rescan of 2025-08-25 → 2025-09-01. |
| `code/robustness.py` | Serial correlation, changepoint search, stationary block bootstrap, Newey–West HAC inference, ADF, coverage thresholds. |
| `code/predicate_backfill.py` | Correction 2: canonical Polygon PoS predicate balances at the panel-aligned pre-break blocks and the migration bracket. |
| `code/buffer_dynamics.py` | Per-leg and aggregate flow regressions, discrete operations and terminal buffer accounting. |
| `code/head_snapshot.py` | Complete documented-universe head reading, including the HyperCore containment check. |

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
| `data/usdt0_timeseries.csv` | 183 aligned rows, per-chain supply columns, observed backing (`collateral` in the legacy schema), ratio, escrow controls. |
| `data/usdt0_break.csv` | 6-hourly bracketing panel around the August 2025 event. |
| `data/usdt0_summary.json` | Computed summary statistics (Tables 1, 3, 5). |
| `data/robustness.json` | All Section 4 statistics. |
| `data/usdt0_panel_v1_12chain.csv` | **The superseded 12-chain panel**, retained so the correction in Section 1 can be checked directly rather than taken on trust. |
| `data/universe_table.md` | Documented deployment set versus measured set. |
| `data/polygon_predicate_prebreak.json` | Canonical Polygon predicate balances used to correct the pre-break series. |
| `data/buffer_dynamics.json` | Per-leg flow coupling, discrete backing-account operations and the terminal drawdown. |
| `data/head_snapshot_20260801.json` | Complete documented head reading: 20 direct supply legs, ratio 1.000298, measured difference 1.029m token units. |

### Known limits, stated in the paper

- The **historical panel** is unbalanced: chains returning live supply rise from
  8 to 17 across the sample, and archive-depth failure is zero-filled. Those
  coverage limits bias panel-era direct supply down. They do not apply to the
  separate 1 August complete-universe head snapshot.
- The not-deployed label is not verified by an `eth_getCode` check, so
  archive-depth failure and genuine non-deployment are not distinguished. Both
  are zero-filled in the panel and both bias historical ratios up.
- Tron and TON are Legacy Mesh rather than direct USDT0 lockbox supply. MegaETH is
  now measurable. HyperCore is verified as a sub-ledger already contained in
  HyperEVM supply and is not double-counted.
- The complete documented head reads span roughly a minute rather than one aligned
  block height. At the measured 1.029m-unit difference (about 3bp), the sign is within
  measurement noise.
- A balance read cannot establish the legal availability of locked USDT, Tether's
  reserve quality or redemption capacity, what net cross-chain messages are in flight,
  whether technical settlement is legally final, or whether the deployment registry is
  complete. At a 3bp margin, each limitation can dominate the measured difference.

---

## Paper 2 — Points-program economics after empirical rejection

### Code

| File | What it does |
|---|---|
| `code/tullock_sim.py` | Exact active-set equilibrium solver, scalar cost-invariance and revenue-capture scenarios, wallet-splitting tests. |
| `code/tullock_mc.py` | 500-draw Monte Carlo per σ at n = 5,000, plus the wallet-splitting sensitivity sweep. |
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
| `data/tullock_results.json` | Propositions 1–4: symmetric equilibrium, scalar cost invariance, heterogeneous active sets, fixed-budget wallet-splitting invariance, and modeled revenue capture. |
| `data/tullock_mc.json` | Monte Carlo sampling distributions per σ, and the wallet-splitting sensitivity sweep. |
| `data/verify_output.txt` | Raw output of the verification suite. |
| `data/sim_output.txt` | Raw output of the simulation. |

### Known limits, stated in the paper

- The model scenarios are not calibrated against an observed points program. The
  HYPE/EIGEN figures cited in the revised executive summary come from Paper 3 and
  are not inputs to the simulation.
- Checks A, B and D in the verification suite all evaluate or solve the model's
  own first-order condition. Only check C is calculus-free. The suite establishes
  that the solver solves the stated game correctly. It does not establish that
  the game describes reality.
- The model assumes complete information, simultaneous moves, risk neutrality,
  linear costs and no capital constraint. Paper 3 rejects the active-set result
  as a wallet-level description for the primary measured programs.
- Proposition 2 is invariant to a scalar common marginal cost in the symmetric
  unconstrained game. A binding hard quantity cap is a separate corner constraint
  and is **not** solved by that proposition; the original cap generalization was retracted.
- Proposition 3 is not new. It restates the standard asymmetric-Tullock
  active-set characterisation; see the paper's Section 1 for attribution.

---

## Paper 3 — Wallet-level airdrop allocation concentration

### Code

| File | What it does |
|---|---|
| `code/collect_airdrops.py` | Collects the HYPE genesis vector and the EIGEN/ENA distribution logs with checkpointed, range-splitting public-RPC reads. |
| `code/analyze_airdrops.py` | Computes concentration statistics, matched-*n* model bands, Lorenz curves and the prespecified finite-grid joint simulation test. |

### Data

| File | Contents |
|---|---|
| `data/airdrops/hype_genesis_raw.json` | Complete raw HYPE genesis state before the six documented system-account exclusions. |
| `data/airdrops/hype_recipients.json` | 90,912 HYPE recipient wallets used in the primary test. |
| `data/airdrops/eigen_recipients.json` | 239,035 EIGEN Season 1 recipient wallets with both phases merged per wallet. |
| `data/airdrops/ena_recipients.json` | Four ENA claim channels merged over the full scanned horizon. |
| `data/airdrops/concentration.json` | Reported concentration statistics, matched-n bands and joint rejection results. |

### Known limits, stated in the paper

- All concentration measurements are wallet-level. Wallet splitting can make
  beneficial-owner concentration higher; omnibus or custodial addresses can make
  one wallet represent many beneficiaries and move the bias in the opposite direction.
- HYPE is a post-eligibility allocation; EIGEN is claims data, so owed-but-unclaimed
  allocations are absent; ENA claim executors can aggregate beneficiaries.
- The model rejection is anchored on HYPE and EIGEN. ENA is a lower-resolution
  cross-check, not equal-quality primary evidence. The paper does not identify the
  causal mechanism behind the model failure; the capital-mirror explanation is a hypothesis.

---

## Paper 4 — ERC-8056 Stock Token interface risk

Paper 4 combines primary-source protocol semantics with a purposive public-code search. It
does **not** claim that any named wallet or application lacks runtime support. On 7 August
2026, eight canonical ERC-8056 queries returned zero matches across a nine-repository GitHub
search scope; a `balanceOf` positive control returned indexed code. Suwappu's pre-change
`main` snapshot returned zero canonical markers under the same identifier family.

### Code

| File | What it does |
|---|---|
| `code/verify_erc8056_audit.mjs` | Offline consistency checks for the released repository/query counts and Chainlink 10:1 split fixture arithmetic. |

```bash
node code/verify_erc8056_audit.mjs
```

### Data

| File | Contents |
|---|---|
| `data/erc8056-public-code-audit.json` | Observation date, nine-repository sample, eight canonical queries, zero-match results, positive control, Suwappu pre-change check, primary-source URLs, interpretation boundary, and official split-example arithmetic. |

### Known limits, stated in the paper

- The nine repositories are a purposive integration sample, not a population-representative
  sample from which an ecosystem support rate can be estimated.
- GitHub code search reflects indexed public default-branch code at observation time. Private
  services, generated code, dynamic selectors, third-party metadata, unindexed branches, and
  differently named adapters can implement the semantics without matching the queries.
- The released record preserves the observed search and can be checked offline. Repeating the
  live search against a later GitHub index requires GitHub code-search access and tests a new
  observation rather than reproducing the historical index state bit-for-bit.
- ERC-8056 is Draft. The identifiers or integration guidance can change.
- The 10:1 split fixture is an official Chainlink documentation example, not a measured user
  incident, and the study does not establish that a live non-1x multiplier has caused an error.

---

## Paper 5 — Cross-chain execution latency calibration

Paper 5 tests one narrow economic explanation for Suwappu's current cross-chain
speed tiebreak: whether minute-scale financing carry can calibrate a policy that
permits up to a 10bp winner-score concession for a sufficiently faster trusted-time
route. It cannot at the pinned benchmark. At 3.65% SOFR on a simple ACT/360 basis,
10bp equals 9.8630 days of carry. The paper then specifies the outcome data needed
to estimate the non-carry value of speed rather than assuming it.

### Code

| File | What it does |
|---|---|
| `code/settlement_latency_value.py` | Standard-library calculation of the five latency/carry scenarios. Regenerates both the CSV and `/research/latency-carry.svg` from pinned inputs. |

Run from this directory:

```bash
python3 code/settlement_latency_value.py
```

### Data

| File | Contents |
|---|---|
| `data/settlement_latency_value.csv` | SOFR value date/rate, ACT/360 convention, 10bp policy ceiling, carry bps, cap/carry multiple, implied simple annual rate, and $1m scale illustration for 1, 5, 10, 30 and 60 minutes saved. |

### Known limits, stated in the paper

- The study is a scenario calibration, **not production TCA**. It does not measure
  speed-tiebreak frequency, affected order values, provider-ETA accuracy, realized
  savings, failure/retry outcomes, or time to a legally defined finality point.
- The 10bp source rule is relative to winner score, not automatically input notional.
  Dollar examples require a credible economic mark for the scoring unit.
- SOFR is a public cash-carry benchmark, not Suwappu's disclosed funding cost or a
  universal institutional hurdle rate. Non-carry terms such as market exposure,
  failure/retry, operational liquidity and explicit SLA value remain unestimated.
- Provider-reported ETA is treated as route-duration evidence. It is not promoted
  into legal settlement finality without a separately defined endpoint.

---

## Environment

Python 3.12+ with `numpy`, `pandas`, `scipy`, `statsmodels`, `matplotlib`.
Chain reads use the standard library only. Paper 4's offline audit consistency check uses
Node.js 18+ and no third-party packages. Paper 5's reproduction script is
standard-library-only and makes no network call.

## Licence and citation

Released for verification and reuse. Cite as:

> Natsagdorj, T. (2026). *Measuring Protocol Backing of an Omnichain Dollar:
> A Point-in-Time USDT0 Token-Unit Reconciliation, Twice Corrected.* Suwappu Research.

> Natsagdorj, T. (2026). *Points-Program Economics After Empirical Rejection:
> Conditional Tullock Benchmarks for Participation, Dissipation, Fee Denomination,
> and Wallet Splitting.* Suwappu Research.

> Natsagdorj, T. (2026). *Airdrop Allocation Concentration: A Wallet-Level Field
> Test of the Tullock Active-Set Model.* Suwappu Research.

> Natsagdorj, T. (2026). *When balanceOf() Stops Meaning What the User Thinks:
> ERC-8056 Integration Risk in Robinhood Stock Tokens.* Suwappu Research.

> Natsagdorj, T. (2026). *What Is a Minute of Cross-Chain Execution Worth?
> Pricing Latency Without Confusing ETA for Finality.* Suwappu Research.

## Disclosures

Suwappu builds cross-chain execution infrastructure spanning several of the
chains measured in Paper 1 and operates a points program of the class analysed
in Paper 2. Paper 5 evaluates Suwappu's own current cross-chain speed-tiebreak
policy. Full disclosures are in each paper's final section. This is
research, not investment advice, a reserve attestation, legal opinion, credit rating,
regulatory classification or prudential-capital opinion.
