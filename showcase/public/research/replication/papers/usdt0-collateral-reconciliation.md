# Measuring Protocol Backing of an Omnichain Dollar: A Point-in-Time USDT0 Token-Unit Reconciliation, Twice Corrected

**Tsolmondorj Natsagdorj (0xSoftBoi)**
Suwappu Research
26 July 2026; third revision 6 August 2026

*What this is: a 12-month, block-height-aligned reconciliation of USDT token units in canonical USDT0 backing accounts against documented direct USDT0 token supply, read from public chain state. It is not a valuation of Tether's reserve assets, a test of USDT redemption capacity, a legal opinion on holder claims, a stress-liquidity analysis, or a reserve attestation. This is the third version of the measurement. The first omitted 134.8m units of USDT0 supply; the second used the wrong Polygon backing address. Both corrections are preserved because population and reference-data failures are the central control finding.*

*Suwappu builds cross-chain execution infrastructure spanning several of the chains measured here and holds operational stablecoin balances, including USDT and USDT0, incidental to running it. Full disclosures in Section 9. The views expressed are those of the named author.*

---

## Executive summary

- **Current protocol-backing result: 1.000298x.** At 01:53 UTC on 1 August 2026, the Ethereum lockbox held **3,453,608,822.61 USDT** against **3,452,579,539.64 USDT0** across the complete documented direct-supply perimeter. The 1,029,282.97-unit arithmetic difference is about three basis points. Because the head reads span roughly 60 seconds and do not observe in-flight messages, legal availability, or registry omissions, we classify the result as **par within measurement tolerance**, not as an economic reserve cushion.

- **This measures USDT0 → USDT backing, not USDT → dollar reserves.** USDT0's architecture uses USDT locked on Ethereum to support remote USDT0 supply. Tether's reserve assets, redemption terms, issuer credit, holder rights, market liquidity and stressed convertibility are separate layers. A 1.0000x protocol reconciliation cannot eliminate those inherited risks.

- **Two corrections identify the principal control risk: the perimeter.** V1 omitted 134.8m USDT0 units and manufactured apparent surplus. V2 used the wrong Polygon backing address and manufactured apparent shortfall. The canonical Polygon PoS predicate held 1,219.7m–1,386.7m USDT across the 16 pre-migration observations; restoring it produces corrected aggregate coverage of **1.017–1.028x, median 1.021x**.

- **The 27 August 2025 migration independently validates the account mapping.** Across a six-hour bracket, the canonical predicate fell 1,358.8m USDT, within about 82k units (0.006%) of Polygon supply at bracket open; the Ethereum lockbox rose 1,258.6m USDT while Arbitrum supply fell 98.1m units. USDT0's contemporaneous migration notice describes the same transfer of backing into the Ethereum lockbox.

- **Historical excess should not be underwritten as structural.** The post-migration arithmetic difference ranged from 5.1m to 760.3m token units, or 15bp to 18.7% of measured supply. In the final eight days of the panel, backing fell 192.9m units while measured supply fell 75.7m units; the difference compressed by roughly 117m units. None of the 183 corrected panel observations is measured below par, but persistence reduces the 165-observation post-migration sample to roughly 39 independent looks and the historical panel is unbalanced.

- **The complete head perimeter contains 20 direct supply legs.** HyperCore is a sub-ledger already contained in HyperEVM supply and is not added again. MegaETH is directly measured. Tron and TON are classified by USDT0 under the separate Legacy Mesh and therefore are not counted as direct USDT0 supply against the Ethereum lockbox.

## Why this matters

USDT0 introduces a second backing layer on top of USDT. In the [USDT0 developer documentation](https://docs.usdt0.to/technical-documentation/developer/), the Ethereum adapter locks or unlocks USDT while remote USDT0 contracts mint or burn token units through LayerZero messaging. Tether's own reserve assets and redemption obligations sit beneath that architecture and are not measured here.

For this paper the observed protocol identity is:

$$R_t = \frac{B_t}{S_t}, \qquad B_t = \text{USDT token units in canonical backing accounts}, \qquad S_t = \sum_{i=1}^{N}\text{USDT0 totalSupply}_i(t)$$

This is a **token-unit reconciliation**, not a USD mark-to-market collateral ratio. One USDT unit is compared with one USDT0 unit because that is the protocol convention. We do not value Tether's reserve portfolio, haircut USDT for market or liquidity risk, estimate a recovery value, or determine whether a USDT0 holder has a direct or indirect legal claim on the locked asset. The released code and historical data retain the field names `collateral`, `liabilities` and `buffer` from earlier versions; in this revision those mean, respectively, observed protocol backing, documented direct token supply, and their arithmetic difference. They are not legal-accounting conclusions.

The current result is therefore deliberately narrow: **the complete documented USDT0 direct-supply perimeter reconciles to observed USDT backing at 1.000298x, or par within measurement tolerance.** Everything beyond that statement requires a different evidence set.

### Bank assurance boundary

For a bank, this reconciliation is one control input, not a reserve opinion. [CPMI-IOSCO's PFMI guidance for stablecoin arrangements](https://www.bis.org/cpmi/publ/d198.pdf) treats technical versus legal settlement finality, the enforceability of holder claims, timely convertibility at par in normal and stressed conditions, and the credit and liquidity risk of a privately issued settlement asset as distinct questions. This study does not test those conditions.

Nor is the arithmetic ratio automatically a regulatory “model.” The Federal Reserve, OCC and FDIC's [2026 revised model-risk guidance (SR 26-2)](https://www.federalreserve.gov/supervisionreg/srletters/SR2602.pdf) excludes simple arithmetic and deterministic rule-based processes from its definition of a model. The control problem here is primarily **reference-data quality, population completeness, change control, documentation and appropriate use of the output**. If a bank adds statistical models, forecasts, valuation haircuts or loss estimates around the ratio, those additions need their own classification and governance.

This paper also makes no determination under the Basel Committee's [SCO60 cryptoasset framework](https://www.bis.org/basel_framework/chapter/SCO/60.htm?inforce=20260101&published=20240717). Prudential classification, redemption-risk testing and capital treatment are separate questions.

The corrections matter in that context. This measurement has been materially wrong twice in symmetric directions: V1 omitted direct supply; V2 misidentified a backing account. Both errors survived technically correct RPC reads. They were corrected by re-deriving the population and account mapping from external documentation rather than trusting the collector configuration. The result is a reference-data lesson before it is a blockchain lesson.

## 1. Correction history

| | v1 (26 Jul) | v2 (26 Jul, corrected) | v3 (1 Aug, this version) |
|---|---|---|---|
| Direct-supply universe | 12 chains | 17 measured + 5 named unmeasured | 22 documented entries: 20 direct supply legs, 1 sub-ledger (verified), 1 Ethereum adapter (backing side) |
| Latest ratio | 1.042 | 1.0015 (panel) / 1.001 (head) | 1.0003 (complete-universe head) |
| Latest arithmetic difference | 137.5m units | 5.1m / 2.7m units | **1.029m units** |
| Pre-break reading | not analyzed | 0.513–0.588, account "unidentified" | **1.017–1.028, account identified** |
| Error corrected | — | 134.8m units of omitted USDT0 supply | 1.22–1.39bn USDT in a mis-attributed backing account |

The two corrections moved the headline in opposite directions — the first destroyed a reported surplus, the second destroyed a reported shortfall — and both were correctable from public state at a cost of a few RPC calls. Neither direction of error is privileged. That is the point.

## 2. Method

### 2.1 Point-in-time alignment

Chains have block times from Ethereum's ~12 seconds to sub-second L2s. We fix a target UTC timestamp and, independently per chain, locate the highest block $b$ with $\text{timestamp}(b) \leq t_{\text{target}}$, via an interpolation-accelerated search with a per-chain block→timestamp cache. Every term in every cross-chain sum is evaluated at a block on the same side of the target, to within one block interval per chain. An unaligned sum is not a snapshot: it mixes states minutes apart, which matters precisely during the large-flow events an observer most wants to date. (The complete-universe head reading in this version is the deliberate exception, and is labeled as such wherever it appears.)

### 2.2 Direct state reads

No block explorer API, subgraph, or third-party indexer is used in the panel. Every direct-supply figure is `totalSupply()` (selector `0x18160ddd`) via `eth_call` against the verified USDT0 token contract at the resolved block; backing-account figures are `balanceOf()` (selector `0x70a08231`) against canonical Ethereum USDT (`0xdAC17F958D2ee523a2206206994597C13D831ec7`). The primary post-migration backing account is the USDT0 OAdapter lockbox, `0x6C96dE32CEa08842dcc4058c14d3aaAD7Fa41dee`. Hedera's HTS token is read through the public JSON-RPC relay; every deployment was verified live for symbol, decimals and non-degenerate supply before inclusion, and every remote token confirms 6 decimals.

### 2.3 Provenance: each leg has a backing account, and they are not the same account

On several chains the contract now serving as USDT0 is the chain's pre-existing canonical USDT contract, upgraded in place. The two material cases divide by *how the original supply was issued*:

- **Arbitrum** (`0xFd08…Cbb9`): natively issued by Tether. Its pre-USDT0 backing was at the Tether issuer layer; on migration to USDT0 (January 2025, before our sample begins) corresponding USDT entered the USDT0 lockbox. Consistent with this, the lockbox covers the OFT legs *plus Arbitrum* at 1.026–1.051 at every pre-break observation. The Arbitrum L1 bridge gateway plays no role and holds 140k–346k USDT throughout — it was never the backing account because this supply was not bridge-minted through that gateway.
- **Polygon** (`0xc213…8e8F`): bridge-minted through Polygon's PoS bridge. Its backing account was therefore the bridge's Ethereum escrow — the canonical ERC20 predicate at **`0x40ec5B33f54e0E8A33A975908C5BA1c14e5BbbDf`** — until the 27 August 2025 migration moved that backing into the lockbox.

Version 2 tested the predicate hypothesis and reported it falsified, because the address it read — `0x8484Ef722627bf18ca5Ae6BcF031c23E6e922B30`, which we had recorded as "Polygon ERC20 predicate" — held 0.02 USDT. That address is not the canonical predicate. The canonical predicate held 1.2–1.4bn USDT. The control failed not because the hypothesis was wrong but because the account was, and nothing in the 0.02-unit reading distinguishes "empty backing account" from "wrong address." Section 5 returns to this.

**Optimism remains the cautionary counter-example in the other direction**: its L1StandardBridge holds 214.9m USDT — backing Optimism's *separate legacy* USDT contract (`0x94b0…8e58`), not the USDT0 contract we measure there (`0x01bF…3071`). Same chain, same ticker, different contract, different backing account. Between Polygon and Optimism, the lesson is bilateral: a backing-account reading, empty or full, means nothing until the account↔leg mapping is verified.

### 2.4 Sample

183 aligned observations at 48-hour intervals, 2025-07-26 to 2026-07-25 — partitioned throughout as 16 pre-break, 2 transition observations spanning the migration itself (2025-08-27 and 2025-08-29, ratios 1.013 and 1.012, both above par, excluded from both regime samples), and 165 post-break; a 6-hourly rescan over 2025-08-25 to 2025-09-01; a 16-observation archive backfill of the canonical predicate at the panel's aligned Ethereum blocks; and a complete documented head snapshot at 01:53 UTC on 2026-08-01. The panel is unbalanced — chains returning live supply rise from 8 to 17 — and the not-deployed label is not verified by `eth_getCode`, so archive-depth failure and genuine non-deployment are both zero-filled; both bias historical measured supply down. These caveats from v2 stand.

Archive retention, spot-checked 2026-07-31: Monad serves ~2–3M blocks (≈7–10 days at its measured 0.30s block time; failure signature `-32602 "historical state not available"`), Stable ~300–400k blocks (≈2.4–3.2 days at 0.70s; `-32000 "header not found"` or an IAVL pruning error from its Cosmos base). MegaETH serves at least 1M blocks. History on those legs remains truncated; spot reads do not.

## 3. Results

### 3.1 The consolidation, confirmed

Version 2 bracketed a 1,258,602,286-USDT lockbox inflow to 27 August 2025 12:00–18:00 UTC (Ethereum blocks 23,232,316 → 23,234,104) and inferred, from Arbitrum supply *falling* across the same bracket, that an existing pool of USDT had been deposited. The inference was correct, incomplete, and unnecessary. The complete accounting, all reads at the bracket blocks:

| Account / quantity | 12:00 UTC | 18:00 UTC | Δ |
|---|---:|---:|---:|
| Polygon PoS predicate (`0x40ec…bbDf`) | 1,366,840,226 USDT | 7,998,647 USDT | **−1,358,841,579 USDT** |
| USDT0 lockbox | 1,431,763,721 USDT | 2,690,366,007 USDT | **+1,258,602,286 USDT** |
| Polygon USDT0 supply | 1,358,759,150 USDT0 | 1,358,516,202 USDT0 | −242,948 USDT0 |
| Arbitrum USDT0 supply | 974,524,900 USDT0 | 876,429,994 USDT0 | −98,094,906 USDT0 |

The predicate outflow matches Polygon supply at bracket open to within 82k token units. The migration moved approximately the Polygon leg's one-for-one backing and left 8.0m USDT in the predicate (which remained at the latest read). One nuance from independent re-verification is material: the predicate received a **10.6m-USDT inflow in the six hours before the bracket opened** (1,356.2m at 06:00; 1,366.8m at 12:00). At six-hour granularity, predicate coverage of Polygon supply may therefore have dipped fractionally below 1.0 (~0.998) just before migration. The 1.006–1.015 range refers only to the 16 panel-aligned observations; it is not a statement about every intra-panel hour. The aggregate measured perimeter remained above par at those inspected points because of the lockbox difference. Of the 1,358.8m USDT that left the predicate, 1,258.6m entered the lockbox and the 98.1m-unit Arbitrum supply contraction explains most of the remainder, leaving about 2.1m units of net residual flow within the bracket.

The issuer described the event, in public, the same day: *"The supply backing PoS USDT on Polygon has now been migrated to the USDT0 lockbox on Ethereum mainnet, making it auditable by anyone at any point in time"* (USDT0 blog, 27 August 2025). Version 2 wrote that "an issuer statement would change our view" while that statement had been published eleven months earlier. The changepoint machinery — the sup-F search, the block bootstrap — dated an event whose date was in a press release. We keep the statistics in Section 4 for what they still show (how much spurious break evidence persistence alone can generate), but the evidentiary weight was always in the balance reads.

### 3.2 One system, correctly accounted

With the predicate restored to the backing side, the two "regimes" of version 2 collapse into one observed token-unit accounting perimeter whose backing was *split across two accounts* until August 2025 and consolidated thereafter.

**Table 3. The corrected series, by regime and by leg**

| | Pre-break (n=16) | Post-break (n=165) |
|---|---:|---:|
| Aggregate ratio, v2 as published | 0.513 – 0.588 | 1.002 – 1.187 |
| **Aggregate ratio, corrected** | **1.017 – 1.028 (median 1.021)** | unchanged (median 1.032) |
| Lockbox ÷ (direct supply − Polygon) | 1.026 – 1.051 (median 1.032) | — (single account) |
| Predicate ÷ Polygon supply | 1.006 – 1.015 (median 1.007) | — (migrated) |
| Observations below 1.0 | **0 of 16** | 0 of 165 |

*Source: `data/usdt0_timeseries.csv` + `data/polygon_predicate_prebreak.json` (16 archive reads of the canonical predicate at the panel's aligned Ethereum blocks). Corrected pre-break backing = lockbox + predicate; the predicate's 8.0–18.1m-unit difference over Polygon supply is included and never exceeds 0.7% of measured direct supply. Post-break, the predicate residual is no longer attributable to USDT0 and is excluded.*

Two observations. First, the pre-break lockbox-leg median and the post-break median both round to 1.032 (1.0318 and 1.0316). The measured difference over the legs backed by the lockbox was therefore similar before and after the accounting-perimeter migration. The data do **not** identify a policy target or management intent. Second, version 2's published pre-break series, 0.513–0.588, measured the boundary of our address book, not the economic condition of the system. **Zero of 183 corrected panel observations has a measured token-unit ratio below 1.0** — with an important qualification. The final panel row covers 17 supply legs and reports a 5.1m-unit difference; three additional documented legs held a combined 4.9m units at the complete head read six days later (Sei 2.6m, MegaETH 2.2m, Hedera 0.1m). If their 25 July balances were similar, the complete-universe terminal difference would have been on the order of 0.2m units, with sign indeterminable. That is an inference, not a measured historical point.

### 3.3 Backing-difference dynamics: no stable proportional rule

The post-break arithmetic difference between measured backing and direct supply ran 5.1m–760.3m token units (median 113.7m), or 15bp–18.7% of measured direct supply (median 3.2%). The released analysis calls this quantity the `buffer`; here we avoid treating that label as evidence of an economic reserve cushion. Three descriptions are tested:

**A stable proportional target is not supported by the observed range.** The difference as a share of measured supply spans 15 basis points (2026-07-25) to 18.7% (2025-12-15), a 124× range; at the measured-supply peak it was 45bp and at the post-break trough it was 2.25%. A constant proportional target is inconsistent with that range. The levels correlation, corr(B, L) = −0.10, has little power here (persistence leaves ~38 effective observations; the 95% interval spans roughly −0.40 to +0.23) and is not used as evidence for a policy rule.

**A passive residual description is also incomplete.** Eleven 48-hour changes in the backing difference exceed 100m units. Several are much larger than contemporaneous changes in measured supply: +508.1m units on 7–9 December against +210.9m of supply; −597.3m on 15–17 December against +13.8m; and +393.8m on 3–5 November during a 1.58bn-unit supply contraction, followed by −395.4m two days later. These observations show large balance adjustments not explained one-for-one by same-window supply flow. They do not, by themselves, identify the operator's intent, policy, or cause.

**What survives is a description, not a policy inference:** strong per-leg flow coupling, punctuated by large changes in backing that are not explained one-for-one by contemporaneous supply changes. The correctly specified flow regressions (Section 4) put each backing account against its associated supply leg at β ≈ 1 with correlation 0.99, and 62% of 48-hour steps change the difference by less than 10m units. The public data cannot distinguish treasury discretion, a floor, pre-funding, settlement timing, or another operating rule.

**The difference compressed toward par by sample end.** It fell from 296.9m units (31 Dec 2025) to 145.2m (31 Mar) to 78.9m (29 Jun), recovered to 122.4m (17 Jul), then fell to **5.1m** at the final panel observation. In the final eight days, measured backing fell 192.9m units while measured supply fell 75.7m units: backing declined by roughly 117m units more than supply. The data establish that arithmetic; they do not establish why it happened. The historical exceedance — no measured observation below par, worth roughly 39 independent looks after persistence — is a statement about the historical sample. The complete head result is a separate, more current observation at roughly three basis points.

### 3.4 Composition, and the complete-universe reading

**Table 4. Every documented leg, current head, 1 August 2026 01:53 UTC (single session, not block-aligned)**

| Leg | Supply | | Leg | Supply |
|---|---:|---|---|---:|
| Arbitrum | 867.0m | | Stable | 27.4m |
| Polygon | 849.3m | | Flare | 23.1m |
| Plasma | 774.8m | | Conflux eSpace | 16.8m |
| Mantle | 440.7m | | Optimism | 9.8m |
| XLayer | 113.1m | | Tempo | 8.2m |
| HyperEVM | 111.9m | | Unichain | 5.9m |
| Monad | 93.7m | | Morph | 4.7m |
| Ink | 61.4m | | Sei | 2.6m |
| Berachain | 38.1m | | MegaETH | 2.2m |
| Rootstock | 1.7m | | Hedera | 0.09m |
| **Σ direct USDT0 supply** | | | | **3,452.6m units** |
| **USDT in lockbox** | | | | **3,453.6m units** |
| **Ratio / arithmetic difference** | | | | **1.000298 / 1.029m units** |

*Source: `data/head_snapshot_20260801.json`, `code/head_snapshot.py`. HyperCore is not a row: its Core-side float (12.27m units at the spot lock address `0x2000…010c`) is contained within the HyperEVM `totalSupply()` above — verified by direct read — so adding it would double-count. Ethereum's registry row is the OAdapter lockbox itself. Reads span ~60 seconds of wall clock. Scaling the panel's 48-hour flow distribution to that window, typical read-skew is approximately 16k–165k units and even the sample's most volatile flow interval scales to under 1m. This scaling exercise addresses read timing only; it does not measure in-flight messages, legal availability, or registry completeness.*

This is the first reading in the project's history with no unmeasured documented direct-supply leg. Its content is: **the observed token-unit difference is three basis points and should be treated as par within measurement tolerance.** Monad rose from 72.1m units at the panel's last read (25 July) to 93.7m at the head reading, +30% in 6.3 days, and is one of the legs whose longer history cannot be backfilled; that is why historical population coverage and current head coverage are reported separately.

Tron and TON, version 2's largest named holes, do not belong in this table. The USDT0 documentation places them in the Legacy Mesh, where native USDT connects through liquidity pools and an Arbitrum hub rather than being counted as direct USDT0 supply against the Ethereum lockbox. That is a different liquidity and counterparty perimeter. This paper does not measure it; treating full Tron or TON native-USDT supply as an omitted USDT0 lockbox leg was our category error.

## 4. Robustness

**Serial correlation** (unchanged from v2): post-break AR(1) 0.616, Ljung–Box rejects white noise at every lag; Newey–West SEs are 1.70× naive; effective sample size 39.2 of 165. The 95% HAC interval on the post-break mean is [1.025, 1.038], conditional on the coverage drift, and "165 of 165 above par" is ~39 independent looks at a persistent, actively-operated series.

**Flow coupling** (new, and corrected in this revision): using the legacy dataset field names, the aggregate regression Δ`collateral` on Δ`total_liabilities` gives β = 0.967 (NW SE 0.034, n=164) post-break and β = 0.890 (SE 0.049, n=15) pre-break. Economically these variables are observed USDT backing and direct USDT0 supply. The pre-break coefficient is *rejected* against 1 at the 5% level (t = −2.22), a specification artifact: pre-break, ~15% of direct-supply flow was Polygon flow, whose backing account was the predicate, not the lockbox. Regressed correctly by leg: Δlockbox on Δnon-Polygon supply, **β = 1.018 (SE 0.010)**; Δpredicate on ΔPolygon supply, **β = 1.085 (SE 0.032)**; Δ(lockbox+predicate) on Δtotal supply, **β = 1.002 (SE 0.015)** — correlations 0.99 throughout (`data/buffer_dynamics.json`, `pre_break_per_leg`). The per-leg specification supports the split-backing attribution flow by flow. None of these regressions can distinguish mechanical matching from a small proportional margin policy (β = 1.00 vs 1.03 is inside one standard error post-break), which is why Section 3.3 makes no policy inference from them.

**Changepoint** (reweighted): the sup-F search (5,214.8 against a bootstrap 95th percentile of 337.1, p = 0.0045) still locates the break correctly, but its null distribution's heavy tail (max 14,287) is best read as a warning about spurious breaks under persistence. The event itself is documented by USDT0 and reconciled to roughly 82k token units in Section 3.1; the statistical test corroborates the directly observed balance event rather than establishing it independently.

**Stationarity**: post-break ADF rejects a unit root (−4.92, p = 3e-05); a mean is a meaningful summary, subject to coverage drift.

**Coverage sensitivity** (revised): the panel-era thresholds stand for history — 50m units of unmeasured supply flips 26.1% of post-break observations below par; 100m units flips 41.8%. At the complete documented head reading, no documented direct-supply leg is unmeasured. The remaining uncertainties are different: legal availability of the USDT, net instructions in flight, read timing, and registry completeness. Any unobserved net item above 1.029m token units can change the sign of the arithmetic difference. We have not measured the size of those items, so the correct classification is par within measurement tolerance rather than positive excess coverage.

## 5. The symmetric rule, now applied to ourselves twice

Version 2 stated the rule: *both sides of the invariant must be enumerated from an external registry and verified account by account, not inherited from whatever the collector was already configured to read.* It stated the rule because we had violated its direct-supply half — 12 chains configured, 22 documented entries, 134.8m USDT0 units uncounted.

This version exists because we then violated the backing-account half. The control read an address our configuration called "Polygon ERC20 predicate," got 0.02 USDT, and concluded the account was empty — when the canonical predicate, one lookup away in Polygon's own bridge documentation, held 1.37bn USDT. The reading was correct; the account mapping was not; and the published conclusion ("the backing account is unidentified") was the opposite of what a correctly addressed read showed. An empty balance at a wrong address is indistinguishable from an empty backing account, which is why the mapping, not the RPC response, requires independent verification.

The naive-measurement taxonomy from v2 therefore gains its missing entry. **Universe truncation** (supply side): sum what is configured and report an artifactual surplus. **Account misattribution** (backing side): read what is configured and report an artifactual shortfall — or, in Optimism's mirror-image version, an artifactual pass. **Timestamp misalignment**: impair the ability to date a cross-chain state change. We committed the first two and test the third explicitly. A production reconciliation needs a controlled population and account↔leg mapping before the arithmetic is run.

## 6. Implications

**For issuers.** Publish a machine-readable registry: legs, contract addresses, *and the backing account for each leg, per period*. Every error in this paper's history traces to reconstructing that mapping by hand. The 27 August statement shows the issuer already narrates backing migrations; a registry entry is the same fact in a form a monitor can consume. Publish the Legacy Mesh pool addresses for the same reason.

**For treasury, risk and anyone routing the asset.** The complete documented check takes roughly twenty direct supply reads plus the backing-account read and returns 1.000298x. It cannot determine the legal availability of the locked USDT, the economic quality of Tether's reserves, redemption access, stressed liquidity, technical-versus-legal finality, in-flight message state, or whether the published registry is exhaustive. The on-chain check is therefore a monitoring input, not a credit or settlement-asset conclusion.

**For anyone building a control.** Monitor six things continuously: the aligned token-unit ratio; per-leg supply and associated backing account against the published mapping; rate of change per leg; legacy-account controls *with verified addresses*; measured-versus-documented population count; and the arithmetic backing difference as the materiality threshold for unexplained items. Separately monitor message state and issuer/legal/liquidity evidence; those are not derivable from the stock ratio.

## 7. What would change our view

- **Evidence that locked USDT is legally unavailable or subject to a claim that changes recoverability.** We measure a token balance, not legal status or priority. The current arithmetic difference is only 1.029m token units.
- **`basisPointsRate` set nonzero on canonical USDT.** The OFT transfer path assumes lossless transfers (Guardian L-02); Tether's fee parameter is currently 0. Nonzero, credited amounts diverge from received amounts silently. Dormant, and still the one structural path we know of by which the invariant could break by design.
- **In-flight LayerZero messages.** Debited at source but not yet credited at destination, or the reverse depending on transfer stage, can create a temporary stock mismatch. We do not measure net in-flight state. Any net amount above 1.029m units is material to the sign of the current arithmetic difference.
- **Backfilled archive access to Monad, Stable, Tempo, Morph, Conflux.** Without it, no time-series claim survives beyond constant-coverage windows; with Monad growing 30% in five days, the truncated history is increasingly the story.
- **Visibility into the Legacy Mesh pools.** Tron/TON native-USDT conversion liquidity is a distinct liquidity and counterparty question this paper does not answer; published pool and credit-state data would make a separate control possible.
- **A dated correction from the issuer** to any figure here. Given this paper's history, we would treat that as the expected case, not the surprising one.

## 8. Reproducibility

Everything is regenerable from public endpoints with no credentials. New in this version: `code/predicate_backfill.py` (archive reads of the canonical predicate at the panel's 16 pre-break aligned blocks *and* the Section 3.1 bracket blocks → `data/polygon_predicate_prebreak.json`), `code/buffer_dynamics.py` (per-leg and aggregate flow regressions, level tests, the full census of >100m-unit changes, and terminal-drawdown accounting → `data/buffer_dynamics.json`), `code/head_snapshot.py` (complete documented head reading including the HyperCore containment check → `data/head_snapshot_20260801.json`), and `code/collect_usdt0.py` updated with the MegaETH leg and corrected predicate account. Carried over: the collection harness (`DAYS=365 STEP_HOURS=48`), `analyze_usdt0.py`, `break_scan2.py`, `robustness.py`, the 183-row panel, the 6-hourly bracket, and the superseded v1 12-chain panel. The wrong-address reads that produced v2's Table 2 are preserved in `data/usdt0_timeseries.csv` (`escrow_Polygon_ERC20Pred` column) so Correction 2 is itself auditable.

## 9. Disclosures

This is research, not investment advice, a reserve attestation, audit opinion, legal opinion, credit rating, regulatory classification, PFMI assessment, or prudential-capital opinion, and nothing here is a recommendation to buy, sell, hold, or treat any asset as an eligible settlement asset. Suwappu builds cross-chain execution infrastructure spanning several of the chains measured; this reconciliation began as an internal check on our own balance accounting. We hold operational stablecoin balances, including USDT and USDT0, incidental to running that infrastructure, and no directional position informed by this analysis. We did not contact Tether, Everdawn Labs, or any issuer named; no party named reviewed any version before publication. The first correction originated in an external adversarial review we commissioned; the second in our own registry re-verification while preparing this revision — after publishing the wrong number twice. The subsequent adversarial pass surfaced the terminal-drawdown omission, flow-regression mis-specification, and count and power errors now fixed in Sections 3.3 and 4. Every measurement input is public chain state or a cited public document.

## References

- USDT0, *Technical Documentation — Deployments* and *The Legacy Mesh*, `docs.usdt0.to`, accessed 31 July 2026. Source of the 22-leg registry and the Tron/TON mesh classification.
- USDT0, *Developer Guide*, `docs.usdt0.to/technical-documentation/developer/`, accessed 6 August 2026. Source of the Ethereum lock/unlock and remote mint/burn architecture.
- USDT0 blog, *"Polygon USDT Now Upgraded to USDT0,"* 27 August 2025 (mirrored at `mirror.xyz/tetherzero.eth`; PR via Chainwire, same date). Source of the migration statement quoted in Section 3.1.
- LayerZero, *Omnichain Fungible Token (OFT) Standard*, `docs.layerzero.network/v2/concepts/applications/oft-standard`, accessed 6 August 2026. Source of the generic debit/credit conservation model.
- Tether, *Legal Terms* and *Transparency*, `tether.to`, accessed 6 August 2026. Source of issuer-authored descriptions of USDT reserve backing, issuance and redemption; not independent assurance.
- Polygon, *PoS Bridge documentation* (canonical ERC20 predicate `0x40ec5B33f54e0E8A33A975908C5BA1c14e5BbbDf`), accessed 31 July 2026.
- Everdawn Labs, `usdt0-audit-reports` (ChainSecurity, Guardian, Paladin, OpenZeppelin, Zellic), accessed 26 July 2026. Source of Guardian L-02.
- Chaos Labs, *USD₮0 Mechanism Design Review*, 8 April 2025. Prior art on architecture and risk; contains no time-series or reconciliation measurement.
- CPMI-IOSCO (2022), *Application of the Principles for Financial Market Infrastructures to stablecoin arrangements*. Used only to frame the legal-finality, credit, liquidity and stressed-convertibility questions that this study does not answer.
- Board of Governors of the Federal Reserve System, FDIC and OCC (2026), *Supervisory Guidance on Model Risk Management*, SR 26-2, 17 April 2026. Used to distinguish deterministic reconciliation controls from models as defined in the guidance.
- Basel Committee on Banking Supervision, *Basel Framework, SCO60 — Cryptoasset exposures*, version in force 1 January 2026. This paper does not make an SCO60 classification.
- Newey, W. and West, K. (1987), *Econometrica* 55(3). HAC standard errors.
- Politis, D. and Romano, J. (1994), *JASA* 89(428). Stationary bootstrap.
- Bai, J. and Perron, P. (1998), *Econometrica* 66(1). Changepoint search.
