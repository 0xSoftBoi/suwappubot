# Measuring Collateral Backing of an Omnichain Dollar: A Point-in-Time Reconciliation of USDT0, Twice Corrected

**Tsolmondorj Natsagdorj (0xSoftBoi)**
Suwappu Research
26 July 2026; second revision 1 August 2026

*What this is: a 12-month, block-height-aligned reconciliation of USDT0's on-chain collateral against its circulating liabilities, read directly from chain state. It is the third version of this measurement, and each version corrected the one before it. The first covered 12 chains and reported a 3–4% surplus; completing the liability universe removed 96% of it. The second reported a month-long period in which the system appeared 51–59% collateralized, with the backing account "unidentified"; this version identifies that account — we had verified the wrong address — and the corrected series never falls below par. Both corrections are documented in full, because the errors are the most instructive part of the work.*

*Suwappu builds cross-chain execution infrastructure spanning several of the chains measured here and holds operational stablecoin balances, including USDT and USDT0, incidental to running it. Full disclosures in Section 9. The views expressed are those of the named author.*

---

## Executive summary

- **For the first time, the full documented liability universe is measurable, and the measured buffer is $1.0m — three basis points.** At current head on 1 August 2026 (01:53 UTC), in one session, the Ethereum lockbox held $3,453.6m of USDT against $3,452.6m of USDT0 across every deployment the issuer documents — 20 legs read directly, one verified as a sub-ledger of another, and none excluded. Ratio 1.0003. The reads are not block-aligned, so at this margin the sign of the buffer is within measurement noise: the honest statement is that backing is indistinguishable from exactly 1:1, with no measurable cushion.

- **Correction 2: the pre-break "shortfall" was our error, not the system's.** Version 2 reported 16 observations at ratios of 0.513–0.588 and named the backing account "unidentified" after its escrow control — an address we had labeled the Polygon ERC20 predicate — read $0.02 throughout. That control checked the wrong address. The canonical Polygon PoS predicate, `0x40ec5B33f54e0E8A33A975908C5BA1c14e5BbbDf`, held $1,219.7m–$1,386.7m of USDT across the entire pre-break window, covering Polygon-leg supply at 1.006–1.015 at all 16 observations. Including it, the corrected aggregate ratio is **1.017–1.028, median 1.021**: the system never appears under-collateralized at any of the 183 observations in the sample.

- **The August 2025 event is not an anomaly; it is a documented migration, and the issuer said so at the time.** A blog post dated 27 August 2025 states: *"The supply backing PoS USDT on Polygon has now been migrated to the USDT0 lockbox on Ethereum mainnet."* The chain state agrees to five decimal places: within our six-hour bracket the predicate fell $1,358,841,579 — matching Polygon supply at the bracket open, $1,358,759,150, to within $82k (0.006% of the flow) — while the lockbox rose $1,258,602,286 and Arbitrum supply fell $98,094,906, leaving $2.1m of residual attributable to ordinary two-sided flow. Version 2 called this "consolidation is our inference." It was confirmable at publication; we failed to find the statement.

- **The buffer is operated to no discernible size rule — and it was wound down to par by sample end.** The buffer's share of liabilities spans 15 basis points to 18.7%, a 124× range, which no proportional target survives. Nor is it inert: eleven discrete 48-hour movements exceed $100m and do not correspond to liability flow, including +$508m in and −$597m out against essentially flat supply. Per-leg flow regressions confirm the split-backing attribution step by step — Δlockbox on Δnon-Polygon liabilities gives β = 1.018 (SE 0.010) and Δpredicate on ΔPolygon gives β = 1.085 (SE 0.032), correlations 0.99 both — so each account matched its own leg's flow throughout. The decision-relevant fact for an allocator: the buffer fell from $296.9m at end-2025 through $122.4m on 17 July to $5.1m at the panel's last observation, with collateral withdrawn $117m beyond liability decline in the final eight days. The historical record shows no observation below par; the endpoint shows the cushion run down to measurement noise.

- **Tron and TON hold no USDT0 — the biggest "unmeasured" holes were misclassified, by us.** The issuer's deployment registry lists 22 native USDT0 legs; Tron and TON are not among them. They participate through the separate "Legacy Mesh," in which native Tether USDT is converted against liquidity pools via an Arbitrum hub — a different system with different liabilities, not lockbox mint-and-burn. MegaETH, the remaining named hole, is now directly measurable ($2.2m, public RPC, verified). HyperCore is a sub-ledger whose float ($12.3m) we verified is contained inside the HyperEVM supply the panel already counts.

## Why this matters

Omnichain stablecoins move dollar liabilities across chains through lock-and-mint mechanics. For the underlying token, backing is an off-chain reserve attested periodically by an auditor. For the omnichain representation, backing is an on-chain escrow balance, and the invariant is continuously verifiable by anyone with archive RPC access:

$$\text{collateral}(t) = \text{balanceOf}(\text{lockbox}, t) \geq \text{liabilities}(t) = \sum_{i=1}^{N} \text{totalSupply}_i(t)$$

This is narrower than "is USDT fully backed." We are not auditing Tether's reserves. We measure whether the omnichain representation is solvent *as a bridge*, at the one layer of the stack that can be checked cheaply and continuously from public state.

Version 2 concluded that full backing could not be verified from public EVM state alone, because material legs were unreadable. Both facts that drove that conclusion have changed — one because the world changed (MegaETH exposed a public RPC), and one because our classification was wrong (Tron and TON were never USDT0 liabilities). The revised conclusion is sharper in both directions. **Spot verification of the complete documented universe is now possible, and we performed it: the system is backed 1.0003 : 1.** And because the margin is three basis points, everything the balance check cannot see — encumbrance of the escrowed USDT, messages in flight, an incomplete registry — is now larger than the buffer. The check has become possible exactly at the scale where the check alone stops being sufficient.

The other reason this paper matters is Section 5. This measurement has now been materially wrong twice, in symmetric ways: once by omitting liabilities (12 of 22 legs), once by mis-verifying collateral (the wrong predicate address). Both errors produced confident, wrong headline numbers that survived internal review, and both were caught by re-deriving the universe — of liabilities, then of backing accounts — from the issuer's own published registry rather than from our configuration. We document both because any team building a solvency monitor for this asset class will face exactly these two failure modes, in this order.

## 1. Correction history

| | v1 (26 Jul) | v2 (26 Jul, corrected) | v3 (1 Aug, this version) |
|---|---|---|---|
| Liability universe | 12 chains | 17 measured + 5 named unmeasured | 22 documented legs: 20 measured, 1 sub-ledger (verified), 1 adapter (collateral side) |
| Latest ratio | 1.042 | 1.0015 (panel) / 1.001 (head) | 1.0003 (complete-universe head) |
| Latest buffer | $137.5m | $5.1m / $2.7m | **$1.03m** |
| Pre-break reading | not analyzed | 0.513–0.588, account "unidentified" | **1.017–1.028, account identified** |
| Error corrected | — | $134.8m of omitted liabilities | $1.22–1.39bn of mis-attributed collateral |

The two corrections moved the headline in opposite directions — the first destroyed a reported surplus, the second destroyed a reported shortfall — and both were correctable from public state at a cost of a few RPC calls. Neither direction of error is privileged. That is the point.

## 2. Method

### 2.1 Point-in-time alignment

Chains have block times from Ethereum's ~12 seconds to sub-second L2s. We fix a target UTC timestamp and, independently per chain, locate the highest block $b$ with $\text{timestamp}(b) \leq t_{\text{target}}$, via an interpolation-accelerated search with a per-chain block→timestamp cache. Every term in every cross-chain sum is evaluated at a block on the same side of the target, to within one block interval per chain. An unaligned sum is not a snapshot: it mixes states minutes apart, which matters precisely during the large-flow events an observer most wants to date. (The complete-universe head reading in this version is the deliberate exception, and is labeled as such wherever it appears.)

### 2.2 Direct state reads

No block explorer API, subgraph, or third-party indexer is used in the panel. Every liability figure is `totalSupply()` (selector `0x18160ddd`) via `eth_call` against the verified USDT0 token contract at the resolved block; every collateral and escrow figure is `balanceOf()` (selector `0x70a08231`) against canonical Ethereum USDT (`0xdAC17F958D2ee523a2206206994597C13D831ec7`). Collateral is the balance of the USDT0 OAdapter lockbox, `0x6C96dE32CEa08842dcc4058c14d3aaAD7Fa41dee`. Hedera's HTS token is read through the public JSON-RPC relay; every deployment was verified live for symbol, decimals and non-degenerate supply before inclusion, and every remote token confirms 6 decimals.

### 2.3 Provenance: each leg has a backing account, and they are not the same account

On several chains the contract now serving as USDT0 is the chain's pre-existing canonical USDT contract, upgraded in place. The two material cases divide by *how the original supply was issued*:

- **Arbitrum** (`0xFd08…Cbb9`): natively issued by Tether. Its pre-USDT0 backing was Tether's off-chain reserve; on migration to USDT0 (January 2025, before our sample begins) the corresponding USDT was placed in the lockbox. Consistent with this, the lockbox covers the OFT legs *plus Arbitrum* at 1.026–1.051 at every pre-break observation. The Arbitrum L1 bridge gateway plays no role and holds $140k–$346k throughout — it was never the backing account, because the supply was never bridge-minted.
- **Polygon** (`0xc213…8e8F`): bridge-minted through Polygon's PoS bridge. Its backing account was therefore the bridge's Ethereum escrow — the canonical ERC20 predicate at **`0x40ec5B33f54e0E8A33A975908C5BA1c14e5BbbDf`** — until the 27 August 2025 migration moved that backing into the lockbox.

Version 2 tested the predicate hypothesis and reported it falsified, because the address it read — `0x8484Ef722627bf18ca5Ae6BcF031c23E6e922B30`, which we had recorded as "Polygon ERC20 predicate" — held $0.02. That address is not the canonical predicate. The canonical predicate held $1.2–1.4bn. The control failed not because the hypothesis was wrong but because the account was, and nothing in the $0.02 reading distinguishes "empty escrow" from "wrong address." Section 5 returns to this.

**Optimism remains the cautionary counter-example in the other direction**: its L1StandardBridge holds $214.9m — which backs Optimism's *separate legacy* USDT contract (`0x94b0…8e58`), not the USDT0 contract we measure there (`0x01bF…3071`). Same chain, same ticker, different contract, different backing account. Between Polygon and Optimism, the lesson is bilateral: an escrow reading, empty or full, means nothing until the account↔leg mapping is verified.

### 2.4 Sample

183 aligned observations at 48-hour intervals, 2025-07-26 to 2026-07-25 — partitioned throughout as 16 pre-break, 2 transition observations spanning the migration itself (2025-08-27 and 2025-08-29, ratios 1.013 and 1.012, both above par, excluded from both regime samples), and 165 post-break; a 6-hourly rescan over 2025-08-25 to 2025-09-01; a 16-observation archive backfill of the canonical predicate at the panel's aligned Ethereum blocks (this version); and a complete-universe head snapshot on 2026-07-31. The panel is unbalanced — chains returning live supply rise from 8 to 17 — and the not-deployed label is not verified by `eth_getCode`, so archive-depth failure and genuine non-deployment are both zero-filled; both bias measured liabilities down. These caveats from v2 stand.

Archive retention, spot-checked 2026-07-31: Monad serves ~2–3M blocks (≈7–10 days at its measured 0.30s block time; failure signature `-32602 "historical state not available"`), Stable ~300–400k blocks (≈2.4–3.2 days at 0.70s; `-32000 "header not found"` or an IAVL pruning error from its Cosmos base). MegaETH serves at least 1M blocks. History on those legs remains truncated; spot reads do not.

## 3. Results

### 3.1 The consolidation, confirmed

Version 2 bracketed a $1,258,602,286 lockbox inflow to 27 August 2025 12:00–18:00 UTC (Ethereum blocks 23,232,316 → 23,234,104) and inferred, from Arbitrum supply *falling* across the same bracket, that an existing pool of USDT had been deposited. The inference was correct, incomplete, and unnecessary. The complete accounting, all reads at the bracket blocks:

| Account / quantity | 12:00 UTC | 18:00 UTC | Δ |
|---|---:|---:|---:|
| Polygon PoS predicate (`0x40ec…bbDf`) | $1,366,840,226 | $7,998,647 | **−$1,358,841,579** |
| USDT0 lockbox | $1,431,763,721 | $2,690,366,007 | **+$1,258,602,286** |
| Polygon USDT0 supply | $1,358,759,150 | $1,358,516,202 | −$242,948 |
| Arbitrum USDT0 supply | $974,524,900 | $876,429,994 | −$98,094,906 |

The predicate outflow matches Polygon supply at the bracket open to within $82k — the migration moved the Polygon leg's backing, essentially to the dollar, and left the predicate's $8.0m excess behind (it still holds $8.0m at our latest read). One nuance an independent re-verification of these reads surfaced: the predicate had itself received a **$10.6m inflow in the six hours before the bracket opened** ($1,356.2m at 06:00, $1,366.8m at 12:00), so the exact-match arithmetic was partly enabled by a last-minute true-up — and at 6-hour granularity the predicate's coverage of Polygon supply may have dipped fractionally below 1.0 (~0.998) just before migration. Our 1.006–1.015 coverage range is a statement about the 16 panel-aligned observations, not about every intra-panel hour, and the aggregate stayed over par throughout via the lockbox margin. The re-verification also probed for a second large predicate movement around the bracket and found none: the drain was a single one-shot event, complete by 16:00 UTC. Of the $1,358.8m that left the predicate, $1,258.6m arrived in the lockbox and $98.1m matches the Arbitrum supply contraction in the bracket, leaving $2.1m attributable to ordinary two-sided flow.

The issuer described the event, in public, the same day: *"The supply backing PoS USDT on Polygon has now been migrated to the USDT0 lockbox on Ethereum mainnet, making it auditable by anyone at any point in time"* (USDT0 blog, 27 August 2025). Version 2 wrote that "an issuer statement would change our view" while that statement had been published eleven months earlier. The changepoint machinery — the sup-F search, the block bootstrap — dated an event whose date was in a press release. We keep the statistics in Section 4 for what they still show (how much spurious break evidence persistence alone can generate), but the evidentiary weight was always in the balance reads.

### 3.2 One system, correctly accounted

With the predicate restored to the collateral side, the two "regimes" of version 2 collapse into one continuously-collateralized system whose backing was *split across two accounts* until August 2025 and consolidated thereafter.

**Table 3. The corrected series, by regime and by leg**

| | Pre-break (n=16) | Post-break (n=165) |
|---|---:|---:|
| Aggregate ratio, v2 as published | 0.513 – 0.588 | 1.002 – 1.187 |
| **Aggregate ratio, corrected** | **1.017 – 1.028 (median 1.021)** | unchanged (median 1.032) |
| Lockbox ÷ (liabilities − Polygon) | 1.026 – 1.051 (median 1.032) | — (single account) |
| Predicate ÷ Polygon supply | 1.006 – 1.015 (median 1.007) | — (migrated) |
| Observations below 1.0 | **0 of 16** | 0 of 165 |

*Source: `data/usdt0_timeseries.csv` + `data/polygon_predicate_prebreak.json` (16 archive reads of the canonical predicate at the panel's aligned Ethereum blocks). Corrected pre-break collateral = lockbox + predicate; the predicate's $8.0–18.1m excess over Polygon supply is included and never exceeds 0.7% of liabilities. Post-break, the predicate residual is no longer attributable to USDT0 and is excluded.*

Two observations. First, the pre-break lockbox-leg median and the post-break median both round to 1.032 (1.0318 and 1.0316): the lockbox ran the same ~3% margin over the legs it backed for the entire year — the accounting perimeter changed in August; the margin policy visibly did not. Second, version 2's published pre-break series, 0.513–0.588, measured the boundary of our address book, not the solvency of the system. **Zero of 183 observations in the corrected sample show the system below par** — with one honest qualification that our own method demands. The panel's terminal buffer, $5.1m, is computed on the 17-leg universe; the three documented legs the panel never carried held $4.9m at the head reading six days later (Sei $2.6m, MegaETH $2.2m, Hedera $0.1m). If they held similar balances on 25 July, the complete-universe buffer at the final panel observation was on the order of $0.2m — a sign we cannot determine. The tail of this panel is indistinguishable from par, which is the same thing the head snapshot says, arrived at the same way our Section 5 taxonomy predicts: universe truncation manufactures surplus, even at the sample's last row.

### 3.3 Buffer dynamics: operated, but to no target

The post-break dollar buffer ran $5.1m–$760.3m (median $113.7m), 15bp–18.7% of liabilities (median 3.2%). Three hypotheses about what generates it:

**A proportional policy target is rejected — by the range, not by a correlation.** The buffer's share of liabilities spans 15 basis points (2026-07-25) to 18.7% (2025-12-15, at a mid-cycle $4.08bn), a 124× spread; at the liability peak ($7.69bn) it was 45bp and at the post-break liability trough ($2.75bn, 2025-09-14) it was 2.25%. No maintained ratio produces that. We note for honesty that the levels correlation we might have cited instead, corr(B, L) = −0.10, has essentially no power here (persistence leaves ~38 effective observations; the 95% interval spans roughly −0.40 to +0.23) and rejects nothing on its own — the share range is the evidence.

**An inert residual is also rejected.** Eleven 48-hour buffer movements exceed $100m, and the largest do not correspond to liability flow: +$508.1m into the lockbox on 7–9 Dec against +$210.9m of supply; −$597.3m out on 15–17 Dec against +$13.8m; +$393.8m on 3–5 Nov during a $1.58bn redemption wave in which collateral withdrawal lagged the burn by one observation, unwound (−$395.4m) two days later. Someone operates this account, at nine-figure scale, on discretion — including a settlement-lag pattern in which large redemptions transiently *inflate* the buffer.

**What survives is a description, not a rule:** mechanical per-leg flow-matching punctuated by discretionary operations with no visible size target. The correctly-specified flow regressions (Section 4) put each backing account on its own leg at β ≈ 1 with correlation 0.99, and 62% of 48-hour steps move the buffer by less than $10m. We cannot distinguish, within this class, between pure discretion, a dollar-floor policy, or pre-funding float for expected mints — the operations are consistent with all three.

**And the operations ended the sample by winding the cushion down to par.** The buffer fell from $296.9m (31 Dec 2025) to $145.2m (31 Mar) to $78.9m (29 Jun), recovered briefly to $122.4m (17 Jul), then collapsed to **$5.1m** at the final panel observation: in the last eight days, collateral fell $192.9m against a $75.7m liability decline — a discretionary net withdrawal of ~$117m that took the margin to measurement noise, where the complete-universe head reading ($1.03m) also finds it. The historical exceedance — no observation below par, worth roughly 39 independent looks after persistence — is a statement about the past. The endpoint is a statement about now, and it is the more decision-relevant of the two.

### 3.4 Composition, and the complete-universe reading

**Table 4. Every documented leg, current head, 1 August 2026 01:53 UTC (single session, not block-aligned)**

| Leg | Supply | | Leg | Supply |
|---|---:|---|---|---:|
| Arbitrum | $867.0m | | Stable | $27.4m |
| Polygon | $849.3m | | Flare | $23.1m |
| Plasma | $774.8m | | Conflux eSpace | $16.8m |
| Mantle | $440.7m | | Optimism | $9.8m |
| XLayer | $113.1m | | Tempo | $8.2m |
| HyperEVM | $111.9m | | Unichain | $5.9m |
| Monad | $93.7m | | Morph | $4.7m |
| Ink | $61.4m | | Sei | $2.6m |
| Berachain | $38.1m | | MegaETH | $2.2m |
| Rootstock | $1.7m | | Hedera | $0.09m |
| **Σ liabilities** | | | | **$3,452.6m** |
| **Lockbox** | | | | **$3,453.6m** |
| **Ratio / buffer** | | | | **1.0003 / $1.03m** |

*Source: `data/head_snapshot_20260801.json`, `code/head_snapshot.py`. HyperCore is not a row: its Core-side float ($12.27m at the spot lock address `0x2000…010c`) is contained within the HyperEVM `totalSupply()` above — verified by direct read — so adding it would double-count. Ethereum's registry row is the OAdapter lockbox itself. Reads span ~60 seconds of wall clock. Scaling the panel's own 48-hour flow distribution to that window, typical read-skew is $16k–$165k and even the year's most violent flow regime scales to under $1m — so non-alignment alone rarely reaches the buffer's size. The reason we still do not claim the sign is Section 4's: in-flight messages, encumbrance, and registry completeness each plausibly exceed $1m, and none is visible to a balance read.*

This is the first reading in the project's history with no unmeasured documented leg, and its content is: **the buffer, measured completely, is three basis points.** Monad is also the fastest-growing leg — $72.1m at the panel's last read (25 July) to $93.7m at the head reading, +30% in 6.3 days — and one of the two legs whose history cannot be backfilled, which is the coverage story of Section 2.4 repeating itself in real time.

Tron and TON, version 2's largest named holes, do not belong in this table at all. The issuer's registry lists them under the Legacy Mesh — native Tether USDT on those chains (≈$90.3bn and ≈$1.43bn respectively, both readable via public APIs) converts against liquidity pools through an Arbitrum hub at a 0.03% fee. That is a liquidity system riding alongside USDT0, not supply minted against the lockbox. Its pool addresses are not published in the issuer's docs; its solvency question is real but different, and pretending it was a USDT0 measurement hole was a category error — ours.

## 4. Robustness

**Serial correlation** (unchanged from v2): post-break AR(1) 0.616, Ljung–Box rejects white noise at every lag; Newey–West SEs are 1.70× naive; effective sample size 39.2 of 165. The 95% HAC interval on the post-break mean is [1.025, 1.038], conditional on the coverage drift, and "165 of 165 above par" is ~39 independent looks at a persistent, actively-operated series.

**Flow coupling** (new, and corrected in this revision): the aggregate regression Δcollateral on Δtotal-liabilities gives β = 0.967 (NW SE 0.034, n=164) post-break and β = 0.890 (SE 0.049, n=15) pre-break. The pre-break coefficient is *rejected* against 1 at the 5% level (t = −2.22) — and the rejection is a specification artifact, not an anomaly: pre-break, ~15% of total liability flow was Polygon flow, whose backing account was the predicate, not the lockbox. Regressed correctly, each account on its own leg: Δlockbox on Δnon-Polygon liabilities, **β = 1.018 (SE 0.010)**; Δpredicate on ΔPolygon supply, **β = 1.085 (SE 0.032)**; Δ(lockbox+predicate) on Δtotal, **β = 1.002 (SE 0.015)** — correlations 0.99 throughout (`data/buffer_dynamics.json`, `pre_break_per_leg`). The per-leg specification confirms the split-backing attribution flow by flow, which is stronger evidence than the levels coverage ratios of Table 3. None of these regressions can distinguish mechanical matching from a small proportional margin policy (β = 1.00 vs 1.03 is inside one standard error post-break), which is why Section 3.3 rests nothing on them beyond the mechanics.

**Changepoint** (reweighted): the sup-F search (5,214.8 against a bootstrap 95th percentile of 337.1, p = 0.0045) still locates the break correctly, but its null distribution's heavy tail (max 14,287) is best read as a warning about spurious breaks under persistence. The event itself is documented by the issuer and reconciled to $82k in Section 3.1; the test corroborates, the balances prove.

**Stationarity**: post-break ADF rejects a unit root (−4.92, p = 3e-05); a mean is a meaningful summary, subject to coverage drift.

**Coverage sensitivity** (revised): the panel-era thresholds stand for history — $50m of unmeasured supply flips 26.1% of post-break observations below par, $100m flips 41.8%. At the complete-universe head reading the question inverts: no documented leg is unmeasured, so the binding uncertainties are the ones a balance read cannot see. Any encumbrance above $1.03m, any net in-flight mint volume above $1.03m, or any registry omission above $1.03m flips the sign. These are not exotic magnitudes; they are the reason a 3bp buffer cannot be certified as a surplus from public state, only as indistinguishable from par.

## 5. The symmetric rule, now applied to ourselves twice

Version 2 stated the rule: *both sides of the invariant must be enumerated from an external registry and verified account by account, not inherited from whatever the collector was already configured to read.* It stated the rule because we had violated its liability half — 12 chains configured, 22 documented, $134.8m uncounted.

This version exists because we then violated its collateral half. The escrow control read an address our configuration called "Polygon ERC20 predicate," got $0.02, and concluded the escrow was empty — when the canonical predicate, one lookup away in Polygon's own bridge documentation, held $1.37bn. The reading was correct; the account mapping was not; and the published conclusion ("the backing account is unidentified") was the exact opposite of what a correctly-addressed read would have shown. An empty balance at a wrong address is indistinguishable from an empty escrow, which is why the mapping, not the read, is the thing that needs verification.

The naive-measurement taxonomy from v2 therefore gains its missing entry. **Universe truncation** (liability side): sum what you have configured, report an artifactual surplus. **Account misattribution** (collateral side): read what you have configured, report an artifactual shortfall — or, in Optimism's mirror-image version, an artifactual pass. **Timestamp misalignment**: destroy the ability to date what actually happened. We have now committed the first two personally and demonstrated the third by construction. A monitor for this asset class that does not enumerate *both* sides from the issuer's registry, with an explicit account↔leg mapping table, will eventually publish one of these errors with confidence.

## 6. Implications

**For issuers.** Publish a machine-readable registry: legs, contract addresses, *and the backing account for each leg, per period*. Every error in this paper's history traces to reconstructing that mapping by hand. The 27 August statement shows the issuer already narrates backing migrations; a registry entry is the same fact in a form a monitor can consume. Publish the Legacy Mesh pool addresses for the same reason.

**For allocators and anyone routing the asset.** The complete-universe check now takes about twenty RPC calls and returns 1.0003. What it cannot return is whether the escrowed USDT is encumbered, what is in flight, or whether the registry is complete — and at a 3bp buffer each of those exceeds the margin. The on-chain check has graduated from "impossible" to "necessary but not sufficient," which is a genuine upgrade with a precise limit.

**For anyone building a monitor.** Six series, continuously: the aligned ratio; per-leg supply and its backing account, checked against the published mapping; rate of change per leg (Monad's +30%/5d is the live example); the legacy-escrow controls *with verified addresses*; covered-vs-documented deployment count; and the buffer as a threshold on everything unseen. The fifth and sixth determine whether the first is trustworthy.

## 7. What would change our view

- **Evidence the escrowed USDT is encumbered.** We measure the lockbox's balance, not its legal status. At a $1.03m complete-universe buffer, any encumbrance at all is decisive.
- **`basisPointsRate` set nonzero on canonical USDT.** The OFT transfer path assumes lossless transfers (Guardian L-02); Tether's fee parameter is currently 0. Nonzero, credited amounts diverge from received amounts silently. Dormant, and still the one structural path we know of by which the invariant could break by design.
- **In-flight LayerZero messages.** Debited at source, not yet credited at destination: liabilities are understated by exactly the in-flight amount. Unmeasured by us, and now larger than the buffer whenever in-flight volume exceeds ~$1m, which is routine.
- **Backfilled archive access to Monad, Stable, Tempo, Morph, Conflux.** Without it, no time-series claim survives beyond constant-coverage windows; with Monad growing 30% in five days, the truncated history is increasingly the story.
- **Visibility into the Legacy Mesh pools.** Tron/TON native-USDT conversion liquidity is a distinct solvency question this paper now explicitly does not answer; published pool addresses would make it answerable with the same method.
- **A dated correction from the issuer** to any figure here. Given this paper's history, we would treat that as the expected case, not the surprising one.

## 8. Reproducibility

Everything is regenerable from public endpoints with no credentials. New in this version: `code/predicate_backfill.py` (archive reads of the canonical predicate at the panel's 16 pre-break aligned blocks *and* the Section 3.1 bracket blocks, so the paper's two most load-bearing numbers regenerate from the released script → `data/polygon_predicate_prebreak.json`), `code/buffer_dynamics.py` (per-leg and aggregate flow regressions, level tests, the full census of >$100m operations, and the terminal-drawdown accounting → `data/buffer_dynamics.json`), `code/head_snapshot.py` (complete-universe head reading including the HyperCore containment check → `data/head_snapshot_20260801.json`), and `code/collect_usdt0.py` updated with the MegaETH leg and the corrected predicate account. Carried over: the collection harness (`DAYS=365 STEP_HOURS=48`), `analyze_usdt0.py`, `break_scan2.py`, `robustness.py`, the 183-row panel, the 6-hourly bracket, and the superseded v1 12-chain panel. The wrong-address reads that produced v2's Table 2 are preserved in `data/usdt0_timeseries.csv` (`escrow_Polygon_ERC20Pred` column) so Correction 2 is itself auditable.

## 9. Disclosures

This is research, not investment advice, and nothing here is a recommendation to buy, sell, or hold any asset. Suwappu builds cross-chain execution infrastructure spanning several of the chains measured; this reconciliation began as an internal check on our own balance accounting. We hold operational stablecoin balances, including USDT and USDT0, incidental to running that infrastructure, and no directional position informed by this analysis. We did not contact Tether, Everdawn Labs, or any issuer named; no party named reviewed any version before publication. The first correction originated in an external adversarial review we commissioned; the second in our own registry re-verification while preparing this revision — after, it must be said, publishing the wrong number twice. This revision was itself refereed adversarially before release; that pass surfaced the terminal-drawdown omission, the flow-regression mis-specification, and the count and power errors now fixed in Sections 3.3 and 4, and its surviving findings are incorporated rather than argued with. Every input is public chain state or a cited public document.

## References

- USDT0, *Technical Documentation — Deployments* and *The Legacy Mesh*, `docs.usdt0.to`, accessed 31 July 2026. Source of the 22-leg registry and the Tron/TON mesh classification.
- USDT0 blog, *"Polygon USDT Now Upgraded to USDT0,"* 27 August 2025 (mirrored at `mirror.xyz/tetherzero.eth`; PR via Chainwire, same date). Source of the migration statement quoted in Section 3.1.
- Polygon, *PoS Bridge documentation* (canonical ERC20 predicate `0x40ec5B33f54e0E8A33A975908C5BA1c14e5BbbDf`), accessed 31 July 2026.
- Everdawn Labs, `usdt0-audit-reports` (ChainSecurity, Guardian, Paladin, OpenZeppelin, Zellic), accessed 26 July 2026. Source of Guardian L-02.
- Chaos Labs, *USD₮0 Mechanism Design Review*, 8 April 2025. Prior art on architecture and risk; contains no time-series or reconciliation measurement.
- Newey, W. and West, K. (1987), *Econometrica* 55(3). HAC standard errors.
- Politis, D. and Romano, J. (1994), *JASA* 89(428). Stationary bootstrap.
- Bai, J. and Perron, P. (1998), *Econometrica* 66(1). Changepoint search.
