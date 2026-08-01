# Measuring Collateral Backing of an Omnichain Dollar: A Point-in-Time Reconciliation of USDT0 Across 17 Chains

**Tsolmondorj Natsagdorj (0xSoftBoi)**
Suwappu Research
26 July 2026

*What this is: a 12-month, block-height-aligned reconciliation of USDT0's on-chain collateral against its circulating liabilities, read directly from chain state on 17 EVM chains. It is the second version of this measurement. The first covered 12 chains and reported a 3–4% surplus. Completing the universe removes 96% of it.*

*Suwappu builds cross-chain execution infrastructure spanning several of the chains measured here and holds operational stablecoin balances, including USDT and USDT0, incidental to running it. This reconciliation began as an internal check on our own balance accounting. Full disclosures in Section 9. The views expressed are those of the named author.*

---

## Executive summary

- **USDT0's measured collateralization is 1.002, not comfortably above par.** At the latest panel observation, 2026-07-25, lockbox collateral was $3.383bn against $3.378bn of measured liabilities across 17 EVM chains. The residual buffer is $5.1m, or 15 basis points. An independent read at current head on 2026-07-26, which also picks up Sei and Hedera, leaves $2.7m and a ratio of 1.001. Tron, TON and MegaETH remain unmeasured, so both figures are upper bounds.

- **The 3–4% surplus this paper previously reported is largely a measurement artifact.** Same day, same method, same collateral read: the original 12-chain universe gives 1.042 and a $137.1m buffer; the corrected 17-chain universe gives 1.002 and $5.1m. Completing the universe eliminates 96.3% of the surplus. On the head read, which adds Sei and Hedera, 98.0%.

- **Seven omitted legs, found from the issuer's own deployments page, carry $134.8m.** We verified each independently by direct `eth_call`: Monad $72.31m, Stable $29.57m, Conflux $16.45m, Tempo $9.19m, Morph $4.70m, Sei $2.50m, Hedera $84k. Six of the seven are ordinary EVM contracts requiring one call each.

- **The ratio series is not comparable across time.** The number of chains returning live supply rises from 8 to 17 across the sample; the first 30 observations average 8.7 chains covered, the last 30 average 15.1. Early observations undercount liabilities and are biased upward. The corrected post-break series shows 0 of 165 observations below 1.0 with median 1.032, but that median is upward-biased by exactly this drift and is not a finding about backing.

- **"165 of 165" is roughly 39 independent looks.** Post-break AR(1) persistence is 0.616 with a Ljung–Box p of 4e-25 at lag 10; effective sample size is 39.2 of 165. Newey–West standard errors are 1.70× the naive i.i.d. figure, giving a 95% HAC interval on the post-break mean of [1.025, 1.038] and a one-sided t of 9.3 against a null of 1.0. That interval is conditional on the coverage bias above, so it is an upper region. The exceedance count is evidence of a maintained policy, not of 165 independent tests.

- **A structural break is dated twice, by two independent methods, to the same window.** A 6-hourly balance scan puts a rise of $1,258,602,286 in the lockbox between 27 August 2025 12:00 and 18:00 UTC, against Arbitrum supply *falling* $98.1m. An exhaustive least-squares changepoint search on the 48-hour panel, with no input from that scan, locates the break between 2025-08-25 and 2025-08-27 (sup-F 5,214.8; bootstrap p = 0.0045). The 16 pre-break observations, 0.513 to 0.588, are not a solvency measurement: the canonical bridge escrows that would have held the missing backing were empty, and the account that did hold it is unidentified in our panel.

## Why this matters

Omnichain stablecoin designs move a growing share of dollar liabilities across chains through lock-and-mint mechanics rather than per-chain wrapped-asset custodians. That relocates a solvency question. For the underlying token, backing is an off-chain reserve attested periodically by an auditor. For the omnichain representation, backing is an on-chain escrow balance, and the invariant is continuously verifiable by anyone with archive RPC access:

$$\text{collateral}(t) = \text{balanceOf}(\text{lockbox}, t) \geq \text{liabilities}(t) = \sum_{i=1}^{N} \text{totalSupply}_i(t)$$

This is narrower than "is USDT fully backed." We are not auditing Tether's reserves. We measure whether the omnichain representation is solvent *as a bridge*, at the one layer of the stack that can be checked cheaply and continuously from public state. For an allocator holding USDT0 on a remote chain, that layer determines whether the position is redeemable at par into canonical USDT, whatever the reserve attestation says.

The result that matters for that reader is not the ratio. It is the relationship between the ratio's residual and its own error bar. A measured surplus of $5.1m against a universe whose completeness we have already been wrong about once, by $134.8m, is a surplus smaller than the measurement error around it. **Full backing of USDT0 cannot be verified from public EVM state alone.** That tells an allocator the on-chain check does not substitute for issuer disclosure at this margin, and it tells a supervisor which disclosure would close the gap.

## 1. The correction

The first version of this paper measured 12 EVM chains. Tether documents roughly 22 networks. An adversarial reviewer, working from the issuer's public deployments page and this paper's own method, read the omitted EVM legs and found material supply we had not counted. We verified every one independently by direct `eth_call` at current head.

**Table 1. Like-for-like snapshot at current head, 2026-07-26 (all reads in one session)**

| | Original 12-chain universe | Corrected EVM universe |
|---|---:|---:|
| Lockbox collateral | $3,392.9m | $3,392.9m |
| Measured liabilities | $3,255.4m | $3,390.2m |
| Ratio | 1.042 | 1.001 |
| Buffer | $137.5m | $2.7m |
| Buffer, share of liabilities | 4.2% | 8 basis points |

*Added legs, verified individually: Monad $72.31m, Stable $29.57m, Conflux eSpace $16.45m, Tempo $9.19m, Morph $4.70m, Sei $2.50m, Hedera $84k (HTS, read via mirror node); total $134.80m. Source: authors' direct `eth_call` reads at each chain's current head. Time period: single snapshot, 2026-07-26. These head reads are not block-aligned; over minutes the drift is immaterial against $134.8m, but it is not zero.*

Completing the universe eliminates 98.0% of the reported surplus. Within the re-collected panel, at the last aligned observation on 2026-07-25, the same comparison gives 1.042 and $137.1m on the old universe against 1.002 and $5.1m on the new one, eliminating 96.3%. The difference between the two figures is Sei and Hedera, which the panel does not carry.

The error is ours and it has a clean description. Section 5 of the first version stated the rule that the candidate backing account must be verified rather than assumed. We applied that discipline to the collateral side and not to the liability side, where the symmetric obligation is to enumerate the deployment set from the issuer's registry rather than from the set we already had a collector for. The first version's latest observation carried a $136.5m buffer and named that as the figure unmeasured supply would have to clear. Public EVM state supplied $134.8m of it, within days of writing, at a cost of one contract call per chain.

## 2. Method

### 2.1 Point-in-time alignment

Seventeen EVM chains have seventeen block times, from Ethereum's roughly 12 seconds to sub-2-second L2s. We fix a target UTC timestamp and, independently per chain, locate the highest block $b$ with $\text{timestamp}(b) \leq t_{\text{target}}$. The search is interpolation-accelerated: each step estimates the next candidate by linear interpolation between the timestamps of the current bounds, since block times are locally near-constant, falling back to the timestamp midpoint when a read is non-monotonic. It converges in far fewer RPC round-trips than bisection, and a per-chain `block → timestamp` cache removes redundant lookups across the 183 targets. Every term in every cross-chain sum is evaluated at a block whose timestamp sits on the same side of $t_{\text{target}}$, to within one block interval per chain.

An unaligned cross-chain sum is not a snapshot. It mixes states minutes apart, which matters precisely during the large-flow events an observer most wants to date.

### 2.2 Direct state reads

No block explorer API, subgraph, or third-party indexer is used anywhere in this panel. Every liability figure is `totalSupply()` (selector `0x18160ddd`) called by `eth_call` against the verified USDT0 token contract on each chain at the resolved block. Every collateral and legacy-escrow figure is `balanceOf()` (selector `0x70a08231`) against canonical Ethereum USDT (`0xdAC17F958D2ee523a2206206994597C13D831ec7`) for the relevant holder, at the same resolved block. Collateral is the balance held by the USDT0 OAdapter lockbox, `0x6C96dE32CEa08842dcc4058c14d3aaAD7Fa41dee`. Each deployment address was verified live for symbol, decimals and a non-degenerate supply before inclusion; every remote token confirmed 6 decimals, matching canonical USDT.

### 2.3 Provenance and the legacy-escrow controls

On several chains the contract now serving as USDT0 is not a fresh OFT deployment. It is the chain's pre-existing canonical USDT contract, upgraded in place to speak OFT mint/burn semantics. Arbitrum (`0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9`) and Polygon (`0xc2132D05D31c914a87C6611C10748AEb04B58e8F`) are the two material cases. Supply minted on those tokens before migration was not collateralized by the USDT0 OAdapter lockbox, which did not yet hold the corresponding assets.

The natural hypothesis is that it was collateralized by each chain's own canonical bridge escrow on Ethereum. We test that directly, reading those escrows at the same block heights as everything else, and the hypothesis fails. Across the entire pre-break window the Polygon ERC20 predicate held $0.00 of USDT and the Arbitrum L1 gateway held between $140k and $346k, against a measured shortfall of $1.17bn to $1.33bn.

**Table 2. Legacy bridge escrows, latest observation**

| Account | Address | Balance, 2026-07-25 |
|---|---|---:|
| Polygon ERC20 predicate (USDT) | `0x8484Ef722627bf18ca5Ae6BcF031c23E6e922B30` | $0.02 |
| Arbitrum L1 gateway (USDT) | `0xcEe284F754E854890e311e3280b767F80797180d` | $139k |
| Optimism L1StandardBridge (USDT) | `0x99C9fc46f92E8a1c0deC1b1747d010903E884bE1` | $214.9m |

*Source: `data/usdt0_timeseries.csv`. Time period: single observation, 2026-07-25.*

Optimism is the exception, and the reason is itself the warning. That $214.9m backs Optimism's *separate* legacy USDT contract (`0x94b008aA00579c1307B0EF2c499aD98a8ce58e58`), a different token from the USDT0 contract we measure on Optimism (`0x01bFF41798a0BcF287b996046Ca68b395DbC1071`). Same chain, same asset name, different contract, different backing account.

### 2.4 Sample, and the unbalanced panel

183 observations at 48-hour intervals, 2025-07-26 to 2026-07-25. Eighteen EVM deployments were attempted; 17 returned usable point-in-time state. Sei failed as it did in the first version, with persistent RPC errors at historical blocks, and is excluded from the panel; we read it at head at $2.50m, 7 basis points of measured liabilities. A separate 6-hourly scan covers 2025-08-25 to 2025-09-01.

The panel is unbalanced, and it is unbalanced in a way that biases the headline. Chains returning live supply run from 8 to 17 across the sample. Several newly added chains can be measured today but not backfilled, because public archive access to them is limited or absent: Monad returns supply on 3 of 183 observations, Stable on 1, Tempo on 80, Morph on 90, Conflux on 136. Optimism enters at 122, Mantle at 134, XLayer at 166. The chain set was also assembled as of today, so the universe is selected on end-of-sample information. A point-in-time construction would require a dated deployment registry, which the issuer does not publish and we did not reconstruct.

Fifteen post-break observations, 2026-01-18 to 2026-02-15, carry a Tempo read failure. Tempo's supply is zero on both sides of that window and its first non-zero reading is 2026-03-19, so the omission is immaterial.

## 3. Results

**Table 3. Collateralization ratio and buffer, full sample and by regime**

| | Full sample (n=183) | Pre-break (n=16) | Post-break (n=165) |
|---|---:|---:|---:|
| Date range | 2025-07-26 – 2026-07-25 | 2025-07-26 – 2025-08-25 | 2025-08-31 – 2026-07-25 |
| Min ratio | 0.513 | 0.513 | 1.002 |
| 5th pct | 0.564 | 0.519 | 1.005 |
| Median ratio | 1.030 | 0.562 | 1.032 |
| Mean ratio | 0.990 | 0.557 | 1.031 |
| 95th pct | 1.055 | 0.588 | 1.056 |
| Max ratio | 1.187 | 0.588 | 1.187 |
| Std dev | 0.136 | 0.022 | 0.025 |
| Obs below 1.0 | 16 (8.7%) | 16 (100%) | 0 (0%) |
| Median buffer | $107.6m | −$1.19bn | $113.7m |
| Min buffer | −$1.33bn | −$1.33bn | $5.1m |
| Max buffer | $760.3m | −$1.17bn | $760.3m |

*Source: authors' computation from `data/usdt0_timeseries.csv`. Time period: 2025-07-26 – 2026-07-25, 183 observations at 48-hour intervals. Two transition observations (2025-08-27, ratio 1.013; 2025-08-29, ratio 1.012) are excluded from both regimes: 16 + 2 + 165 = 183. `data/usdt0_summary.json` reports the same statistics over the 168 observations with zero RPC errors (full-sample mean 0.985, median 1.026). Full precision lives in the data files.*

The full-sample column is included for completeness and should not be used. Pooling two regimes separated by a discrete accounting event yields a mean of 0.990 that corresponds to no state the system was ever in.

**Exhibit 1** (`figures/exhibit-1-collateral.png`): collateral runs well below liabilities until late August 2025, converges in a single step, then tracks close above liabilities through the Plasma-driven expansion and contraction, converging almost exactly at the end of the sample.

**Exhibit 2** (`figures/exhibit-2-ratio.png`), two panels: the ratio above, the number of chains returning live supply below. The ratio declines toward 1.0 over the sample at the same time as coverage rises from 8 chains to 17, and the two movements cannot be separated from public state alone.

### 3.1 A structural break, dated by two independent methods

The 48-hour panel shows the ratio jumping from about 0.52 to about 1.01 in late August 2025. An exhaustive least-squares single-mean-shift changepoint search with 5% trimming, run on the panel alone with no event input, locates the break between 2025-08-25 and 2025-08-27, with a sup-F statistic of 5,214.8 against a 95th-percentile null value of 337.1 under a stationary block bootstrap of the demeaned series (block length 45, 2,000 replications), giving p = 0.0045.

A separate 6-hourly rescan puts the event inside a single bracket. Between 27 August 2025 12:00 and 18:00 UTC, Ethereum blocks 23,232,316 to 23,234,104, the lockbox balance rose from $1,431.8m to $2,690.4m, an increase of **$1,258,602,286**. Across the same bracket Arbitrum USDT0 supply fell from $974.5m to $876.4m, and Polygon supply moved by $242,948.

**Table 4. Lockbox balance and Arbitrum/Polygon supply, 6-hour resolution**

| Datetime (UTC) | ETH block | Lockbox | Arbitrum supply | Polygon supply |
|---|---:|---:|---:|---:|
| 2025-08-27 06:00 | 23,230,527 | $1,397.1m | $961.9m | $1,348.2m |
| 2025-08-27 12:00 | 23,232,316 | $1,431.8m | $974.5m | $1,358.8m |
| **2025-08-27 18:00** | **23,234,104** | **$2,690.4m** | **$876.4m** | **$1,358.5m** |
| 2025-08-28 00:00 | 23,235,895 | $2,691.9m | $876.5m | $1,358.5m |
| 2025-08-28 06:00 | 23,237,685 | $2,700.3m | $878.0m | $1,358.5m |

*Source: `data/usdt0_break.csv`. Time period: 2025-08-25 – 2025-09-01, 6-hour intervals.*

The move is confined to that bracket. Over the following 18 hours the lockbox drifts from $2,690.4m to $2,702.6m, ordinary flow rather than a second step. Arbitrum supply moving down rules out "new liabilities were issued and later over-collateralized." The data are consistent with an existing pool of USDT being deposited into the OAdapter lockbox. The balance change and the absence of a corresponding supply change are observations; "consolidation" is our inference.

### 3.2 Two regimes, and what the first one is not

Pre-break, 16 observations from 2025-07-26 to 2025-08-25: ratio 0.513 to 0.588, median 0.562, every observation below 1.0, median shortfall $1.19bn, coverage constant at 8 chains throughout. Read naively that says USDT0 was 51% to 59% collateralized for a month. It cannot be read that way, and the escrow controls in Section 2.3 rule out the reading that would have made it benign in the obvious way.

Two readings survive. Pre-migration supply on Arbitrum and Polygon was issued against off-chain reserves rather than any on-chain escrow, in which case the on-chain invariant did not apply to it and the pre-break ratio measures nothing. Or the backing sat in an account we did not identify. Both are consistent with $1.26bn arriving at once against flat liabilities, and the balances we read do not separate them. The defensible statement is that the pre-break lockbox did not back measured supply and the account that did is unidentified in our panel.

### 3.3 The buffer

Post-break, the buffer ranged from $5.1m to $760.3m, median $113.7m, and from 15 basis points to 18.7% as a share of measured liabilities, median 3.2%. The dollar minimum and the share minimum are the same observation, the last one: 2026-07-25, $5.1m against $3.378bn, at the sample's highest coverage of 17 chains. The buffer is thinnest where the measurement is most complete.

The second-thinnest share, 45 basis points on 2025-10-18, falls on the sample's largest measured liability base, $7.69bn, with only 10 chains covered. Measured at 10 chains, the system was proportionally thinnest at its largest.

Post-break, 43 of 165 observations (26.1%) held a buffer under $50m, 69 (41.8%) under $100m, and 147 (89.1%) under $200m.

**Exhibit 3** (`figures/exhibit-3-buffer.png`), two panels: the buffer in dollars above and as a share of liabilities below. The share panel shows the buffer was proportionally thinnest when the system was largest, and thinner still at the end of the sample once coverage is complete.

### 3.4 Composition and concentration

**Table 5. USDT0 supply by chain, 2026-07-25, with measurement coverage**

| Chain | Supply | Share | Provenance | Obs. with live supply (of 183) |
|---|---:|---:|---|---:|
| Arbitrum | $884.7m | 26.2% | upgraded-in-place | 183 |
| Polygon | $867.2m | 25.7% | upgraded-in-place | 183 |
| Plasma | $734.9m | 21.8% | native OFT | 161 |
| Mantle | $393.3m | 11.6% | native OFT | 134 |
| XLayer | $112.0m | 3.3% | native OFT | 166 |
| HyperEVM | $108.2m | 3.2% | native OFT | 183 |
| Monad | $72.1m | 2.1% | native OFT | 3 |
| Ink | $67.1m | 2.0% | native OFT | 183 |
| Berachain | $38.2m | 1.1% | native OFT | 183 |
| Stable | $29.9m | 0.9% | native OFT | 1 |
| Flare | $23.3m | 0.7% | native OFT | 183 |
| Conflux | $16.1m | 0.5% | native OFT | 136 |
| Optimism | $9.7m | 0.3% | native OFT | 122 |
| Tempo | $9.3m | 0.3% | native OFT | 80 |
| Unichain | $5.9m | 0.2% | native OFT | 183 |
| Morph | $4.7m | 0.1% | native OFT | 90 |
| Rootstock | $1.7m | 0.1% | native OFT | 183 |

*Documented deployments not in the panel: Sei ($2.50m at head, 2026-07-26), Hedera ($84k), MegaETH, Tron, TON. Source: `data/usdt0_summary.json`, `latest_chain_breakdown`, and `data/usdt0_panel.csv` for coverage counts. Time period: supply at 2026-07-25; coverage counts over 2025-07-26 – 2026-07-25.*

Top-three share 73.6%, top-five 88.6%, HHI 0.199, equivalent to roughly 5.0 equal-sized chains. The two upgraded-in-place legacy chains hold 51.9% of measured supply eleven months after the consolidation.

Plasma supply first appears on 12 September 2025 at $132, a deployed but unfunded token. It peaks at $5.35bn on 8 October 2025, 69.8% of all measured liabilities at that instant, and stands at $734.9m on 25 July 2026, a decline of 86.3% and $4.61bn. Incentive-driven supply left at a pace comparable to its arrival. We measure the trajectory and did not attempt to attribute the flows to specific program parameters.

**Exhibit 4** (`figures/exhibit-4-composition.png`): the Plasma boom and bust dominates the shape of aggregate supply, while Arbitrum and Polygon form a stable base and the newly measured chains enter as thin bands at the top.

## 4. Robustness

**Serial correlation.** The post-break ratio has an AR(1) coefficient of 0.616 (0.950 on the full sample) and a Ljung–Box statistic rejecting white noise at every lag tested (p = 2e-15 at lag 1, 4e-25 at lag 10). Newey–West standard errors, which correct for that persistence, are 0.00336 at four lags against a naive i.i.d. figure of 0.00197, an inflation of 1.70×. The effective sample size is 39.2. "165 of 165 observations above 1.0" therefore corresponds to roughly 39 independent looks at a persistent series: evidence of a maintained collateral policy, not 165 independent tests of one.

**Inference on the post-break mean.** The 95% HAC interval is [1.025, 1.038], and the one-sided HAC t-statistic against a null mean of 1.0 is 9.3. The interval is conditional on the coverage bias in Section 2.4 and is therefore an upper region rather than a two-sided confidence statement about backing. Within the panel, the same 165 observations computed on the original 12-chain universe give a median of 1.035 against 1.032 on 17 chains; the corrected series is lower, and would be lower again on a complete one.

**Stationarity.** An augmented Dickey–Fuller test on the post-break ratio rejects a unit root (statistic −4.92, p = 3e-05, 3 lags, 5% critical value −2.880). The series is mean-reverting, so a mean is a meaningful summary of it, subject to the coverage caveat.

**Break location.** Reported in Section 3.1. The changepoint search uses least squares over all admissible break points with 5% trimming, not visual inspection, and its date agrees with the independent 6-hourly balance scan.

**Coverage sensitivity.** The threshold that matters is the buffer, not the ratio. Unmeasured liabilities above $5.1m flip the latest observation below 1.0. Above $113.7m they flip half the post-break sample. At $50m, 26.1% of post-break observations flip; at $100m, 41.8%; at $200m, 89.1%. Against the $134.8m we have already been wrong by once, these are not exotic magnitudes.

## 5. What a naive measurement concludes, and the symmetric rule

Sum `totalSupply()` across every deployment you happen to have configured, divide the current escrow balance by it, and query each chain at whatever block it happens to be on. Applied to USDT0, that procedure produces two errors that both point the same way.

**Provenance misattribution, on the collateral side.** For the first 16 observations the procedure returns 0.513 to 0.588. Without provenance context that reads as "USDT0 was half-backed for a month." Our controls establish what it is not: the missing collateral was not in the canonical bridge escrows, which held under $350k combined for Arbitrum and Polygon throughout. Publishing 0.557 as a solvency figure would have been wrong; publishing 1.0 for that period would also have been wrong. The honest output is a flagged discontinuity with the backing account named as unidentified.

**Universe truncation, on the liability side.** For the last observation the same procedure, run on a 12-chain universe, returns 1.042 and a $137.1m buffer. The correct figure on the deployment set the issuer documents is 1.002 and $5.1m. Measured liabilities are a lower bound and the ratio is therefore an upper bound, in every observation.

**Timestamp misalignment** is second-order against both, but it is the error that destroys the ability to say *when* something happened. Summing 17 chains at "latest" mixes states separated by minutes and would have made the 27 August break look noisy instead of bracketable to six hours.

The rule generalizes symmetrically. **Both sides of the invariant must be enumerated from an external registry and verified account by account, not inherited from whatever the collector was already configured to read.** On the collateral side that means the backing account is verified rather than assumed. On the liability side it means the deployment set is taken from the issuer's published list, with every entry either measured or named and sized as unmeasured. A monitor that does the first and not the second will report a comfortable surplus that is an artifact of its own configuration file.

## 6. Implications for issuers and allocators

**Publish the deployment count with the ratio.** Any omnichain collateral figure should carry "N of M documented deployments measured" in the same sentence. Our first version did not, and no reader could have detected the gap from the number alone.

**Resolve to a common timestamp, not to each chain's tip.** The interpolation search in Section 2.1 is cheap enough to run continuously. A monitor querying at each chain's head on a fixed wall-clock schedule will show noise during high-flow periods and misdate discrete events by hours.

**Treat an empty legacy escrow as a finding, not a pass.** Arbitrum at $139k and Polygon at $0.02 do not confirm a completed migration; they falsify a hypothesis about where backing sat and leave the question open. Optimism's $214.9m backing a differently-addressed token is what a false positive looks like.

**A production monitor for this class of system should compute six series continuously:** the aligned ratio; per-chain liability share and its trend; rate of change of liabilities per chain, which would have flagged Plasma's slope well before its $5.35bn peak; the legacy-escrow controls; the count of covered versus documented deployments; and the dollar buffer expressed as a threshold on unmeasured supply. The last two determine whether the first is trustworthy.

**For issuers: publish a contemporaneous note when you consolidate collateral.** A $1.26bn single-window change in an escrow balance will look alarming to any outside observer running a naive monitor. One line at the time would have resolved Section 3.1 by confirmation rather than inference.

**Concentration is a watch item, not an alarm.** HHI 0.199 with a two-chain legacy base above half of supply is worth tracking, particularly given how fast the Plasma share moved in both directions.

## 7. What would change our view

- **Any measurement of Tron, TON or MegaETH USDT0 supply.** These are the largest known holes. $5.1m of unmeasured supply flips the latest observation below 1.0 and $113.7m flips half the post-break sample. This is the binding condition and the one we would fund first.
- **Backfilled archive access to Monad, Stable, Tempo, Morph and Conflux.** With it, the post-break series becomes comparable across time and the median can be read as a fact about backing rather than about coverage. Without it, no time-series claim in this paper survives beyond the observations where coverage is constant.
- **Identification of the pre-break backing account.** If the assets backing pre-migration Arbitrum and Polygon supply are located in an on-chain account for the period before 27 August 2025, the pre-break regime becomes measurable and either confirms or refutes coverage in that window. We could not locate it.
- **Evidence the escrowed USDT is encumbered.** We measure the lockbox's balance, not its legal status. If the escrowed USDT is pledged, rehypothecated, or otherwise committed, the balance we read overstates available backing by whatever fraction is claimed. At a 15-basis-point buffer, any encumbrance at all is decisive.
- **`basisPointsRate` set nonzero.** The OFT `_credit()`/`_debit()` paths assume a lossless transfer with no pre/post balance check, a gap flagged in third-party audit review (Guardian L-02). Tether's fee parameter on canonical USDT is currently 0. Were it set nonzero, lockbox-credited amounts could diverge from amounts actually received, breaking the invariant by design rather than by operational event. Dormant today, and the one structural path we know of by which the ratio could be violated silently.
- **An issuer statement contradicting the consolidation reading.** A statement from Tether or Everdawn Labs describing the 27 August 2025 window differently would change the interpretation of the pre-break regime, though not the post-break series.
- **In-flight LayerZero messages.** A transfer debited at source but not yet credited at destination understates liabilities for the seconds to minutes the message is in flight. We did not detect or exclude these. At a $5.1m buffer this is no longer a tail refinement.

## 8. Reproducibility

Four scripts produce every number here. `code/collect_usdt0.py` is the collection harness: point-in-time block resolution and direct `eth_call` reads of `totalSupply()` and `balanceOf()` against the addresses in Sections 2.2, 2.3 and Table 5, using public RPC endpoints only, with no dedicated archive subscription. The 183-observation panel requires `DAYS=365 STEP_HOURS=48`; the defaults produce a different panel. `code/analyze_usdt0.py` computes the ratio series, summary statistics and exhibits. `code/break_scan2.py` runs the 6-hourly rescan of 2025-08-25 to 2025-09-01. `code/robustness.py` computes the serial-correlation diagnostics, changepoint search, block bootstrap, HAC inference and coverage thresholds in Section 4.

Data: `data/usdt0_panel.csv` (3,843 raw entity-date observations across 21 measured entities), `data/usdt0_timeseries.csv` (183 aligned rows with per-chain supply columns), `data/usdt0_break.csv` (6-hourly bracketing panel), `data/usdt0_summary.json` and `data/robustness.json` (computed statistics, reproduced in Tables 1, 3, 5 and Section 4). `data/usdt0_panel_v1_12chain.csv` retains the superseded 12-chain panel so the correction in Section 1 can be checked directly.

Of 3,843 raw cells, 3,089 returned state, 450 are labeled not-deployed, 289 pre-history, and 15 RPC errors, all in Tempo during 2026-01-18 to 2026-02-15. The not-deployed label is not independently verified by an `eth_getCode` check, so archive-depth failure and genuine non-deployment are not distinguished in the panel; both are zero-filled, and both bias liabilities down and the ratio up. This is the same directional bias as the coverage drift and is the principal remaining defect in the collection harness.

A third party with archive RPC access to the listed chains can reproduce the panel, modulo in-flight-message noise and whatever archive depth their endpoints provide.

## 9. Disclosures

This is research, not investment advice, and nothing here is a recommendation to buy, sell, or hold any asset. We build cross-chain execution infrastructure at Suwappu spanning several of the chains measured here; this reconciliation began as an internal check on our own balance accounting. This paper is not a description of, or advertisement for, any Suwappu product. We hold operational stablecoin balances, including USDT and USDT0, incidental to running that infrastructure, and hold no directional position taken on the basis of this analysis. We did not contact Tether, Everdawn Labs, or any other issuer or maintainer named here, and no party named reviewed this paper before publication. Every input is public chain state read from public RPC endpoints. The correction in Section 1 originated in an external adversarial review of the first version of this paper, commissioned by us; the reviewer had no relationship with any issuer named.

## References

- LayerZero Labs, *LayerZero V2 Omnichain Fungible Token (OFT) Standard*, developer documentation, accessed 26 July 2026. Cited descriptively for the mint/burn cross-chain mechanics underlying USDT0's remote representations.
- USDT0, *Technical Documentation — Deployments*, `docs.usdt0.to`, accessed 26 July 2026. Source of the documented deployment set used to construct the corrected universe in Section 1.
- Everdawn Labs, `usdt0-audit-reports`, public GitHub repository, accessed 26 July 2026. Third-party security reviews of the USDT0 OFT contracts by ChainSecurity, Guardian, Paladin, OpenZeppelin and Zellic; source of the dormant fee-on-transfer finding (Guardian L-02) in Section 7. Our review used the public audit PDFs and verified Etherscan bytecode; the underlying source repositories are private.
- Newey, W. and West, K. (1987), "A Simple, Positive Semi-Definite, Heteroskedasticity and Autocorrelation Consistent Covariance Matrix," *Econometrica* 55(3), 703–708. Method for the HAC standard errors in Section 4.
- Politis, D. and Romano, J. (1994), "The Stationary Bootstrap," *Journal of the American Statistical Association* 89(428), 1303–1313. Method for the block bootstrap under the no-break null in Section 3.1.
- Bai, J. and Perron, P. (1998), "Estimating and Testing Linear Models with Multiple Structural Changes," *Econometrica* 66(1), 47–78. Method for the least-squares changepoint search and sup-F statistic in Section 3.1.