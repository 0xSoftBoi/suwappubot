// Research / writing feed. Published posts carry full markdown `body` (rendered
// with the same pipeline as the docs). "planned" posts show as upcoming on the
// index — credible roadmap, not fabricated content.

import stats from '@/data/stats.generated.json';

export type ResearchPost = {
  slug: string;
  title: string;
  date: string; // ISO; empty for planned
  updated?: string; // ISO revision date when materially revised after publication
  category:
    | 'Protocol'
    | 'Architecture'
    | 'Security'
    | 'Agents'
    | 'Benchmarks'
    | 'Reserve risk'
    | 'Mechanism design'
    | 'Empirical test';
  /**
   * 'research' = measurement/theory with released data and a stated method;
   * 'engineering' = how a shipped system works, verified against the code at
   * a stated date. The index renders them in separate sections.
   */
  kind: 'research' | 'engineering';
  excerpt: string;
  readMins?: number;
  status: 'published' | 'planned';
  /** Topic terms emitted into the post's ScholarlyArticle structured data. */
  keywords?: string[];
  /** Canonical long-form paper in the public replication bundle, when one exists. */
  paperPath?: string;
  /** Institutional report edition, when a study has been packaged as a PDF. */
  report?: {
    path: string;
    title: string;
    subtitle: string;
    date: string;
    pages: number;
    metrics: Array<{ value: string; label: string }>;
  };
  /** Evidence visual surfaced by the research index for a featured paper. */
  indexFigure?: {
    src: string;
    alt: string;
    caption: string;
  };
  body?: string;
};

const TEMPO_BODY = `# Gasless swaps on Tempo: fee-payer (type 0x76) transactions, as actually implemented

*Engineering note. Verified against the engine source on 31 July 2026. Two claims in the original version of this post were stale — the accounting is no longer in-memory, and "total cost ≈ $0.001" conflated two different numbers — and both are corrected below.*

Onboarding a new user to crypto has a chicken-and-egg problem: to make their first swap they need gas, but to get gas they usually need to already hold the native token. Tempo's fee-payer transaction type cuts the knot — a sponsor pays the gas so the user doesn't have to.

## Type 0x76: two signers, one transaction

On most chains, the account paying for a transaction must be the account signing it, so a zero-balance wallet cannot broadcast anything. The usual workarounds — faucets, meta-transactions, ERC-4337 paymasters — each add moving parts. Tempo instead defines a transaction type in which the **gas payer and the sender are two different signatures on the same transaction**: the user signs the call, a fee payer counter-signs the gas, the network verifies both and debits the fee payer.

In the real implementation (via the \`pytempo\` SDK), the transaction is domain-separated: the sender signs the type-\`0x76\` hash, the sponsor signs the parallel fee-payer hash (\`0x78\` domain), and the sponsor's signature is attached before broadcast. One detail worth copying if you build on Tempo: the token approval and the swap ride in the **same** 0x76 transaction, so a first-time user needs zero prior on-chain state — no separate approve transaction, no dust of native token, nothing.

## What sponsorship is bounded by (with the real numbers)

Sponsorship is an onboarding perk with hard limits, not an open faucet. The configured defaults:

- **3 sponsored transactions per user, lifetime.**
- **$100 per day of sponsor spend, global**, across all users, on a UTC-day window.
- **A fallback that never blocks**: if sponsorship is unavailable — cap hit, budget exhausted, sponsor wallet unavailable, or any error at all in the sponsorship path — the swap executes normally, user-paid. The sponsorship code is wrapped so that its failure cannot fail a swap.

The original version of this post said the accounting was in-memory and "a restart resets counters." That was true when written and is not anymore: bookkeeping now persists in the database (one row per user carrying a lifetime count and the day's spend), precisely so limits hold across restarts and replicas. We are correcting it prominently because the old sentence described an abuse window — spam right after a deploy — that no longer exists.

## What a sponsored swap actually costs, separated honestly

Two different numbers were blurred together in the original post:

- **The sponsor's cost** (ours): Tempo gas per transaction is sub-cent; the engine books it at an estimated $0.001 per sponsored transaction against the daily budget.
- **The user's cost**: gas is $0.00 on a sponsored swap — but the platform swap fee and market slippage still apply, exactly as on any other swap. "Your first swap costs a tenth of a cent" was our cost wearing the user's clothes; the correct sentence is "your first swap needs no gas token and pays no gas."

Fees on Tempo settle in TIP-20 stablecoins (the fee token is pathUSD), which is what makes the whole flow denominable in dollars end to end.

## Deployment status, stated plainly

The sponsorship path is code-complete, tested, and wired behind a configuration flag that **defaults to off**; enabling it is an operational decision (it requires a funded sponsor wallet and the flag set in the deployment). This post describes the capability and its guardrails, not a promise that any particular swap will be sponsored on any particular day. The unconditional part — Tempo swaps settling with sub-cent fees in stablecoins, approval and swap in one transaction — applies to every Tempo swap, sponsored or not.

## Why this matters for agents

An autonomous agent's first action should not require pre-funding a gas account in a volatile native asset. Fee-payer transactions let an agent hold only stablecoins and still transact from its first call — and the same dual-signature pattern generalizes to any sponsor-the-user flow. That, more than human onboarding, is why we consider the mechanism strategically interesting.
`;

const ROUTING_BODY = `# How Suwappu picks a quote: the race, the ranking rule, and its known gaps

*Engineering note. Every claim below was verified against the engine source on 31 July 2026, with file references; where an earlier version of this post overstated what the ranking does, this version says so.*

Liquidity for any pair is scattered across DEXes, aggregators, and bridges. Suwappu's routing engine races a subset of ${stats.routerCount} integrated providers for each request and returns the winner. This post describes the actual mechanism — including the two places where the honest description is less flattering than the marketing one.

## The roster is ${stats.routerCount} providers; no request races all of them

The full roster: ${stats.routers.join(', ')}. That list is generated from the same source of truth as this page, so it cannot drift from the code.

Every race is **chain-gated**. A same-chain EVM swap races the aggregator set (OKX, 1inch, 0x, KyberSwap, LiFi, CoW when eligible, Socket). A cross-chain same-token transfer races the bridge set (LayerZero, LiFi, CCTP, CCIP, Across, Wormhole, Socket) — CCTP is preferred for native USDC because it is zero-fee. Solana routes through Jupiter, Tron through SunSwap, Starknet through AVNU. These sets are mutually exclusive: the widest single race is about seven providers, and a diagram showing every logo fanning out from one request would describe no request that ever happens.

## The ranking rule, stated exactly

The winner is the route with the highest **quoted output amount**. That is the whole rule.

An earlier version of this post said we rank on "net output — minus gas, minus bridge fees, minus price impact." That described an aspiration, not the code, and the difference matters, so here is the truthful version:

- **Provider fees and price impact are inside the quote.** Aggregators return the amount you would actually receive net of their fees and pool impact, so ranking on quoted output already compares fee-netted numbers. One consequence we handle explicitly: a provider that does *not* net its fees into the quote would unfairly win a raw-output comparison, so its quotes are excluded from the ranking rather than allowed to game it.
- **Gas is not subtracted.** Each quote carries a gas estimate, and we display it, but the ranking does not net it. Cross-provider gas estimates are inconsistently reported and unreliable at quote time; netting bad estimates can flip rankings on noise. The known cost of this choice: for small swaps, a route with a slightly better output and materially worse gas can win. That is a real gap, not a feature.
- **Bridge time is displayed, never ranked on.**

Whether "highest quoted output" actually selects the best realized execution is an empirical question, and as of 31 July 2026 the engine records what it would need to answer it: every quote race now captures the losing routes alongside the winner (provider, quoted output, gas estimate, rank). When enough production data accumulates, the measured answer — including how often the gas gap flips the true ranking — will be a paper on this page, with the dataset released.

## MEV protection is real and conditional — here is the condition

CoW Protocol's batch auctions resist sandwiching, and the engine races CoW for same-chain EVM swaps — but only when the swap carries **no platform fee**, because CoW's order flow cannot carry our fee parameter. Swaps that charge a platform fee (the default for standard accounts) exclude CoW from the race. If you route through us specifically for MEV-shielded execution, that is the condition to know about; fee-exempt flows get it, fee-charged flows currently do not. Solana swaps can submit through Jito bundles, which serves the same purpose there.

## What runs before funds move

All swaps get token-security heuristics before execution, and tokens that fail the honeypot check are hard-blocked with no override. Full buy/sell-cycle simulation — actually simulating the round trip before committing — runs for Solana swaps on paid tiers. EVM swaps do not get pre-flight simulation today; the protection there is the heuristic screen, the honeypot block, and the quote-vs-execution slippage guard.

## One more scoping fact

The race described above lives in the Python engine that serves the Telegram bot and the terminal. The agent REST API (\`/v1/agent/*\`) currently quotes through LiFi on EVM and Jupiter on Solana — one aggregator per ecosystem, not the multi-provider race. The two surfaces converge as the agent API matures; until they do, this paragraph is the honest difference between them.

## Why publish the unflattering version

An execution claim that cannot survive a reader with the source code is worth less than no claim. The engine's real design — race a chain-gated field, rank on provider-netted quoted output, exclude quotes that would game the comparison, display but don't net gas — is a defensible set of engineering trade-offs, and the two known gaps (gas netting, the CoW/fee tension) are now measurable with the telemetry shipped in July 2026. When we can quantify them, we will.
`;


const USDT0_BODY = `# USDT0 backing reconciliation: separating protocol coverage from issuer risk

*Institutional research note. This study tests token-unit backing inside USDT0's cross-chain accounting perimeter. It does not test Tether's reserve portfolio, USDT redemption capacity, or the legal status of the backing asset. The [working paper](/research/replication/papers/usdt0-collateral-reconciliation.md) is canonical; a [nine-page report edition](/research/reports/accounting-for-an-omnichain-dollar.pdf) is available for circulation.*

## Executive conclusion

- **Measured result.** At 01:53 UTC on 1 August 2026, the verified Ethereum lockbox held **3,453,608,822.61 USDT** against **3,452,579,539.64 USDT0** across the complete documented direct-supply perimeter: **1.000298x** token-unit coverage and an arithmetic difference of **1,029,282.97 units, about three basis points**.
- **Interpretation.** The documented protocol perimeter reconciles to par within measurement tolerance. Three basis points is not treated as an economic reserve cushion.
- **Assurance boundary.** The study tests **USDT0 → USDT** backing. It does not test Tether's underlying reserve assets, a holder's legal claim, USDT redemption capacity, stressed convertibility, market liquidity, or prudential treatment.
- **Bank-control conclusion.** Public state is useful as a repeatable first-line reconciliation. It is not sufficient evidence, on its own, for a treasury, credit, liquidity, settlement-finality, or counterparty-risk decision.

| Head snapshot — 1 Aug 2026, 01:53 UTC | Observed public state |
|---|---:|
| USDT in verified Ethereum backing account | **3,453.609m USDT** |
| Documented direct USDT0 supply | **3,452.580m USDT0** |
| Observed token-unit coverage | **1.000298x** |
| Arithmetic difference | **1.029m units / ~3bp** |
| Direct supply legs measured | **20** |

HyperCore is not an additional row: its 12.27m Core-side float was verified as contained within HyperEVM \`totalSupply()\`, so adding it would double-count. MegaETH is included in the head snapshot. Tron and TON sit in the separate Legacy Mesh perimeter and are addressed below.

## First define the instrument and the accounting identity

There are two backing relationships in this structure, and they should not be collapsed into one. [USDT0 describes USDT0 as backed 1:1 by USDT on Ethereum](https://usdt0.to/). Separately, [Tether's terms](https://tether.to/en/legal/?tab=risk-disclosure-statement) describe USDT as backed by Tether's reserves and place issuance and redemption with Tether. Our measurement addresses the first relationship only.

The protocol-level ratio in this study is:

**Observed coverage = USDT token units in canonical backing account(s) / documented direct USDT0 token supply.**

This is a **token-unit** identity, not a mark-to-market collateral test. One USDT unit is compared with one USDT0 unit because that is the protocol's backing convention. We do not mark USDT to dollars, apply a liquidity haircut, value Tether's reserve assets, or estimate a recovery rate. A bank applying credit or liquidity policy to USDT would need to do those things separately.

Two terms also need discipline. In this note, **“backing”** means USDT held in the protocol account that supports USDT0 supply; it does not mean Tether's underlying reserve assets. **“Liability”**, where used in the working paper, means token supply that the protocol accounting identity requires to be backed; it is not a legal opinion on balance-sheet recognition or creditor status.

Before the 27 August 2025 Polygon migration, the measured backing perimeter included the Ethereum lockbox plus the canonical Polygon PoS predicate. After the migration, Polygon moved into the direct USDT0 perimeter and the measured backing sits in the Ethereum lockbox. That change in perimeter is economically important: a ratio is only as reliable as the account map underneath it.

## Four assurance questions, only one of which this study answers directly

For bank diligence, the structure is best read as an assurance stack rather than a single “reserve” claim.

| Layer | Bank question | Evidence in this study | Current reading |
|---|---|---|---|
| **USDT issuer / reserve layer** | What assets back USDT, what legal claim exists, and on what terms can USDT be redeemed? | No independent measurement of Tether's assets or liabilities | **Out of scope.** Use Tether reserve reporting, legal terms, counterparty review, liquidity analysis, and independent assurance |
| **USDT0 protocol backing layer** | Does observed USDT in canonical backing accounts cover documented direct USDT0 supply? | Direct balance and \`totalSupply()\` reads | **Measured. 1.000298x at head; classified as par within tolerance** |
| **Cross-chain operational layer** | Are messages, permissions, contracts, and settlement states behaving as intended? | Point-in-time stocks plus migration and flow cross-checks | **Partially observed.** A stock reconciliation cannot prove message finality, security configuration, or absence of in-flight instructions |
| **Reference-data layer** | Is the deployment universe complete and correctly classified? | Versioned issuer documentation plus independent account verification | **Controlled input, not a theorem.** Two prior errors show why it requires formal governance |

This distinction changes how the result should be used. A perfect 1.0000x USDT0-to-USDT reconciliation would still inherit the economic, legal, liquidity, and issuer risk of USDT. Conversely, weakness in USDT0's token-unit reconciliation would be a separate protocol-level problem even if USDT's own reserve position were strong.

### Supervisory lens: reconciliation is not prudential assurance

The boundary is consistent with the questions supervisors ask, but this paper is **not** a supervisory assessment. [CPMI-IOSCO's guidance on applying the PFMI to stablecoin arrangements](https://www.bis.org/cpmi/publ/d198.pdf) treats settlement finality, legal claims, convertibility at par in normal and stressed conditions, and the credit and liquidity risk of the settlement asset as distinct questions. A token-balance ratio does not answer them. In particular, technical settlement on a ledger is not the same thing as legal finality.

The control also should not be called a regulatory “model” by reflex. The Federal Reserve, OCC and FDIC's [2026 revised model-risk guidance, SR 26-2](https://www.federalreserve.gov/supervisionreg/srletters/SR2602.pdf), expressly excludes simple arithmetic and deterministic rule-based processes from its model definition. The ratio here is deterministic arithmetic. Its main governance risks are **reference-data quality, population completeness, change control and use of the output**. A bank may bring statistical overlays, valuation haircuts, forecasts or other models around that control; those should be classified under the bank's own model-risk framework.

We also make no determination under the Basel Committee's [SCO60 cryptoasset framework](https://www.bis.org/basel_framework/chapter/SCO/60.htm?inforce=20260101&published=20240717). Prudential classification, the redemption-risk test and capital treatment are separate from this measurement.

## The ratio is straightforward; the perimeter is the risk

We have published this measurement three times. The first two versions were materially wrong in opposite directions. Neither failure was an RPC failure or a difficult statistical problem. Both came from getting the accounting perimeter wrong.

| Version | Apparent result | Perimeter error | What a bank should take from it |
|---|---|---|---|
| V1 | 1.042x endpoint; apparent surplus | 134.8m USDT0 of supply omitted; completing the universe removed 96% of the reported difference | Prove population completeness before interpreting the ratio |
| V2 | 0.513–0.588x across 16 pre-migration observations; apparent shortfall | Wrong Polygon backing address | Govern account-to-leg mappings as reference data |
| Current | 1.000298x at complete head; ~3bp difference | Complete documented head perimeter with canonical Polygon mapping | Report token-unit reconciliation separately from issuer-level assurance |

The symmetry matters. V1 understated supply and manufactured apparent surplus. V2 omitted the effective backing account and manufactured apparent shortfall. The contracts answered exactly what they were asked. The control was configured against the wrong population.

For a bank, the address map therefore belongs in controlled reference data. Every row needs an owner, source, effective date, contract identity, backing relationship, containment rule, and change history. The ratio should be downstream of that control, not a substitute for it.

## Polygon shows what a reference-data break looks like

Version 2 reported 16 pre-migration observations at 0.513–0.588x because the address recorded as Polygon's ERC20 predicate held 0.02 USDT. The balance read was correct; the mapping was not. Polygon's canonical PoS predicate is \`0x40ec5B33f54e0E8A33A975908C5BA1c14e5BbbDf\`. Archive reads at the same aligned blocks show **1.22–1.39bn USDT** in that account, covering the Polygon supply leg at 1.006–1.015 in all 16 observations.

![Two series: version 2's published token-unit backing ratio, dashed, falling to 0.51-0.59 before late August 2025, and the corrected measured series including the canonical Polygon predicate, solid, holding above par across the panel.](/research/usdt0-corrected-series.svg "The V2 shortfall was an address-map artifact. Including the canonical Polygon predicate restores the measured pre-migration backing account; the historical panel remains subject to its stated deployment-coverage limits.")

With the canonical account restored, corrected observed pre-migration coverage is **1.017–1.028x, median 1.021x**. Flow analysis independently points to the same attribution: lockbox changes versus non-Polygon supply and predicate changes versus Polygon supply each correlate at 0.99; the correctly specified aggregate flow regression has β = 1.002 (SE 0.015). Full regression output is in the working paper.

The 27 August 2025 migration supplies a cleaner event-level cross-check. Across a six-hour bracket:

- the canonical Polygon predicate fell **1,358.8m USDT**;
- Polygon supply at bracket open was **1,358.759m units**, within about **82k / 0.006%** of the predicate outflow;
- the Ethereum lockbox rose **1,258.6m USDT**;
- Arbitrum supply fell **98.1m units**; and
- approximately **2.1m units** remained as residual two-sided flow.

[USDT0's migration notice](https://blog.usdt0.to/polygon-usdt-now-upgraded-to-usdt0-1-3b-in-usdt-liquidity-available-natively-omnichain) says the Polygon backing supply moved to the Ethereum USDT0 lockbox and that Polygon's existing token became a direct USDT0 deployment. Documentary evidence and chain state therefore identify the same accounting-boundary event. That is the standard a production control should require for a perimeter change.

## The historical difference was large; it was not structural

Post-migration, the nominal token-unit difference between observed backing and measured supply ranged from **5.1m to 760.3m units**, or roughly **15bp to 18.7% of measured supply**. Eleven 48-hour moves exceeded 100m units and did not correspond one-for-one with supply changes. The series does not support treating the historical excess as a stable economic buffer.

![Two panels: the measured backing-minus-supply difference on a nominal 1:1 token-unit basis, peaking near 760m units in December 2025 and declining through 2026, and the difference as a share of measured supply.](/research/usdt0-buffer.svg "Historical measured excess coverage varied materially and compressed toward par by the end of the panel. The chart uses the protocol's nominal 1:1 token-unit convention; it is not a mark-to-market valuation of USDT.")

The final eight days are more decision-relevant than the peak. From 17 to 25 July, USDT backing fell **192.9m units** while measured USDT0 supply fell **75.7m units** — about **117m more units of backing left than supply declined**. The measured difference compressed to 5.1m units.

That terminal panel point needs one more qualification. The final historical row carried 17 supply legs; three additional documented legs held a combined 4.9m units at the complete head read six days later. If their 25 July balances were similar, the complete-universe difference would have been on the order of 0.2m units, with sign indeterminable. That is an inference, not a measured historical point. At this margin, population completeness matters more than another decimal place of RPC precision.

None of the 183 corrected historical observations is measured below par. Within the 165 post-migration observations, serial persistence reduces the effective sample to roughly 39 independent looks, and the historical panel is unbalanced as deployments were added. The complete head snapshot is a separate result. At ~3bp, the appropriate classification is **par within measurement tolerance**, not “overcollateralized.”

## What a bank should monitor

The useful output is not a dashboard tile showing “100.03%.” It is a control stack that prevents a protocol accounting signal from being mistaken for a credit conclusion.

| Control | Minimum evidence | Decision it supports |
|---|---|---|---|
| **Protocol backing reconciliation** | Canonical USDT backing balance + complete direct USDT0 supply, time-aligned where possible | Detect observable divergence from the 1:1 token-unit identity |
| **Perimeter governance** | Versioned deployment registry, source, effective date, containment rule, migrations, contract identity and decimals | Prevent V1/V2-style population and mapping failures |
| **Cross-chain operations** | Message state, pending mint/burn or lock/unlock instructions, contract and security configuration, exception queues | Distinguish a timing item from a genuine stock mismatch |
| **Issuer / asset-risk overlay** | Tether reserve and assurance reporting, legal terms, redemption eligibility, normal/stressed liquidity and concentration analysis, internal haircuts | Convert protocol backing into a bank credit/liquidity view |

The [USDT0 developer guide](https://docs.usdt0.to/technical-documentation/developer/) describes the core mechanism as USDT locked/unlocked on Ethereum and USDT0 minted/burned on remote chains through LayerZero messaging. [LayerZero's OFT documentation](https://docs.layerzero.network/v2/concepts/applications/oft-standard) describes the same debit/credit conservation model. That architecture explains why a balance/supply reconciliation is useful — and why it is incomplete while messages may be between debit and credit states.

A production monitor should retain the prior perimeter so any registry change can be replayed, and it should align observation times across chains as tightly as the infrastructure permits. The current head reads span roughly 60 seconds. Historical read-skew tests were usually 16k–165k units and remained below 1m even in a deliberately stressed interval, but that does not eliminate in-flight message risk.

At the current ~3bp difference, any unseen net item above approximately 1.03m token units can change the sign of the arithmetic result. That is the right scale for exception policy. The 760m historical maximum is not.

## What would change the current assessment

Two different assessments can change, for different reasons.

**The protocol-backing assessment would change** with a documented supply-leg omission, backing-account reclassification, net messages in flight large enough to explain the difference, a transfer-fee setting that changes the conservation identity, or new authoritative deployment data. Given two prior corrections, any such event should trigger remeasurement from the raw state.

**The bank-risk assessment could change even if the 1.000298x ratio did not.** A change in Tether reserve quality, USDT market liquidity or redemption terms, legal availability of the locked USDT, sanctions/freeze exposure, smart-contract authority, cross-chain messaging security, or the relationship between technical settlement and legal finality would affect the economic risk without necessarily moving either side of this ratio.

Tron and TON are intentionally outside this direct-supply reconciliation. [USDT0 documents them within the Legacy Mesh](https://docs.usdt0.to/overview/the-legacy-mesh), which connects native USDT deployments through liquidity pools and a hub rather than treating their full native supply as direct USDT0 supply against this lockbox. That system creates a different liquidity and counterparty perimeter; this article does not measure it.

## Method and reproducibility

The historical panel contains **183 block-height-aligned observations at 48-hour intervals from 26 July 2025 through 25 July 2026**, plus a six-hour migration rescan, a 16-observation archive backfill of the canonical Polygon predicate, and the complete documented-universe head snapshot at 01:53 UTC on 1 August 2026.

All collection uses public chain state. No explorer API, indexer, or credential is required. The ratio is computed in native token units and assumes the protocol's 1:1 USDT/USDT0 accounting convention; it is not USD mark-to-market. Superseded inputs are retained: the original 12-chain panel, wrong-address Polygon control, corrected predicate backfill, buffer analysis, and complete head snapshot can all be inspected alongside the scripts that generated them.

**[Open the working paper, code, data, and correction history](/research/replication)**. The [working paper](/research/replication/papers/usdt0-collateral-reconciliation.md) governs where this abridged article and the paper differ.

Primary architecture sources used to define the perimeter are USDT0's [developer guide](https://docs.usdt0.to/technical-documentation/developer/), [deployment registry](https://docs.usdt0.to/technical-documentation/deployments), and [Polygon migration notice](https://blog.usdt0.to/polygon-usdt-now-upgraded-to-usdt0-1-3b-in-usdt-liquidity-available-natively-omnichain); LayerZero's [OFT standard](https://docs.layerzero.network/v2/concepts/applications/oft-standard); and Tether's [legal terms](https://tether.to/en/legal/?tab=risk-disclosure-statement) and [reserve transparency page](https://tether.to/transparency/). The bank-risk framing also references [CPMI-IOSCO's PFMI stablecoin guidance](https://www.bis.org/cpmi/publ/d198.pdf), the US banking agencies' [SR 26-2 revised model-risk guidance](https://www.federalreserve.gov/supervisionreg/srletters/SR2602.pdf), and the Basel Committee's [SCO60 cryptoasset framework](https://www.bis.org/basel_framework/chapter/SCO/60.htm?inforce=20260101&published=20240717). Party-authored sources define claims made by the relevant parties; citing them is not independent assurance of those claims.

---

*Disclosures: this is research, not a reserve attestation, audit opinion, legal opinion, credit rating, regulatory classification, prudential-capital opinion, or investment recommendation. Suwappu builds cross-chain execution infrastructure spanning several of the chains measured and holds operational stablecoin balances, including USDT and USDT0, incidental to running it; no directional position informed this analysis. Tether, Everdawn Labs, and other named parties did not review the work before publication. The first correction originated in an external adversarial review we commissioned; the second in our own registry re-verification. The current working-paper revision was also adversarially refereed and incorporates the surviving corrections from that pass. All measurement inputs are public chain state or cited public documents.*`;

const POINTS_BODY = `# Points programs are Tullock contests: who actually collects an airdrop

The pitch for a points program is that it converts usage into ownership. Thousands of users earn, the pool splits proportionally, and the token base ends up wide.

The mechanism as written down does not produce that outcome. A pro-rata split of a fixed pool by share of accumulated points is, exactly and not by analogy, a Tullock proportional contest — the class of game Tullock described in 1980. Under realistic conditions its equilibrium concentrates hard. A handful of operators with the lowest cost per point crowd everyone else to zero, without cheating, without any fixed cost of entry, and without a single sybil wallet.

Concentration is the equilibrium, not the failure mode.

**None of the underlying mathematics is new**, and it matters to say so plainly. Existence and uniqueness for the asymmetric case are Szidarovszky and Okuguchi (1997); the sort-and-admit rule and active-player count are Stein (2002); the share-function derivation is Cornes and Hartley (2005); the marginal-entry condition appears in Franke, Kanzow, Leininger and Schwartz (2013); Konrad (2009) covers the family in textbook form. The contribution here is the application to points programs and the sampling distributions, not the algebra.

## The setup

Let a fixed prize be split in proportion to points earned, and let points cost something real to acquire — gas, capital lockup, slippage, or protocol fees. Then each participant faces the payoff of a lottery contest: their share of the prize is their share of total effort, minus what that effort cost them.

Two intuitions fail immediately as a result.

The first is that caps limit extraction, so caps limit waste. They do not. With identical costs, the dissipated fraction is exactly (*n*−1)/*n* — an expression containing no cost term at all. Holding *n* = 100 and sweeping the unit price of a point over a thousandfold range, from $0.10 to $100, dissipation stays at 0.990 throughout: points minted fall from 9.9 million to 9,900 while dollars burned stay pinned at $990k. Caps change how many points get minted. They do not change what share of the pool is burned winning them.

The second is that a points program with common costs spreads an airdrop across a user base. It does once costs are identical — and identical costs are the one case that never happens.

## What happens with realistic cost differences

Solving the equilibrium exactly, for 5,000 potential entrants with no fixed cost of entry and lognormally distributed costs, gives the following. These are medians of 500 independent draws, with the 5th-to-95th percentile band, rather than single runs. σ is the log-standard-deviation of cost per point across participants:

| Cost dispersion | Active operators | Pool as operator profit | Largest operator's share |
|---|---|---|---|
| σ = 0.2 (mild) | 18 of 5,000 | 9.5% | 17.1% |
| σ = 0.4 (moderate) | 10 of 5,000 | 15.8% | 25.9% |
| σ = 1.0 (wide) | 5 of 5,000 | 29.8% | 40.8% |

Note that these are *lower* dissipation figures than the symmetric 99% above — 70% to 90%. That is the point: heterogeneity is what converts burned value into retained profit, and the two scenarios are not comparable line by line.

Two readings matter. The number of participants who are *active at equilibrium* is single-digit to low-double-digit regardless of how many could have entered — adding potential entrants does not proportionally add real ones, because the extra mass is priced out. And the share of the pool that is *not* competed away is not a saving returned to the protocol or its users. It is profit, captured by the same small set of operators.

![Two bar charts with error bars: median active operators out of 5,000 falls from 18 to 5 as cost dispersion rises, while the share of the pool captured as operator profit rises from about 10 percent to 30 percent.](/research/points-participation.svg "As cost dispersion widens, fewer operators stay active and they keep more of the pool. Bars are medians of 500 draws; whiskers span the 5th to 95th percentile.")

For anyone doing diligence on a token distribution, this reframes the question. Wallet counts and points-holder counts describe who showed up, not who gets paid. A program built on continuous, uncapped accumulation should be underwritten as an allocation to roughly ten counterparties, and priced accordingly.

## The one lever that moves anything

If dissipation is fixed by the number of competitors, what does design actually control? Where the burned dollars land.

Split the cost of acquiring a point into the part paid to the protocol as a fee, and the part that leaves the system as gas, bridge cost, or slippage paid to third parties. Total waste is identical either way. The split is not.

![Stacked bar chart comparing four points designs, where protocol revenue rises from fifty thousand dollars under volume denomination to nine hundred sixty thousand under fee denomination, out of a constant amount dissipated.](/research/points-denomination.svg "Same dissipation, four destinations. Denomination decides who keeps it.")

Take the symmetric *n* = 100 case again, on a million-dollar pool: all four designs burn the same $990k. Points denominated on raw volume send $49.5k of that to the protocol, because the cheapest way to manufacture volume is a wash trade whose cost is mostly slippage paid to someone else. Points denominated on fees paid send up to $960k, because the cost of earning a point *is* the fee.

A limit worth stating: as the protocol's share of marginal cost approaches 1, revenue approaches the dissipated amount, not the whole pool. Gas and slippage never fully vanish on a real chain, so the self-funding airdrop needs two conditions at once and gets neither free.

Stated honestly, this is a narrower claim than it first appears. Denomination changes who keeps the value. It does not widen the set of people who capture the pool. A fee-denominated program still concentrates.

## The anti-sybil device that creates the sybil problem

Here is the result we found most surprising.

If points are strictly proportional to fees paid, splitting a fixed budget across many wallets earns exactly the same total. The pool share is invariant to wallet count — sybil-neutral by construction, with no detection system required.

Now add the standard defensive feature: a 25% bonus on the first 5,000 points of *each wallet*. That single addition makes splitting profitable, because a farmer can re-trigger the capped bonus once per wallet. A $100k budget split across 1,000 wallets puts $100 in each — well under the threshold — so every wallet earns the full bonus, where a single wallet earns it only on the first 5,000 of 100,000 points.

How much that pays depends on how much competing effort the farmer faces, so it is a range rather than a number:

| Competing effort (points) | Gain from 1,000 wallets vs 1 | Under strict fee-proportionality |
|---|---|---|
| 100,000 | 1.104× | 0.0 |
| 1,000,000 | 1.209× | 0.0 |
| 20,000,000 | 1.233× | 0.0 |

The gain rises as the farmer's own share of the pool falls, approaching the bonus rate itself. It is a best response against fixed competing effort, not an equilibrium quantity. The mechanism designed to fight sybils is what creates the incentive to be one — and fee-proportional points are exactly invariant at every level tested.

## Postscript: the test has been run, and the sharp prediction failed

This post originally said the model's falsification test — recipient-level concentration at completed programs — had not been run. It now has been, by us, against 330,000 real allocations. The active-set prediction fails by one to two orders of magnitude: measured top-1 shares are 0.73% and 2.40% against the 17-41% band above. The design results below (denomination, sybil neutrality) are unaffected — they are arithmetic, not equilibrium predictions. [The companion paper has the data, the formal rejection, and the diagnosis.](/research/airdrop-concentration)

## What this does not establish

No number in this work is calibrated against an observed points program. It is a model, solved exactly and checked carefully, not a measurement.

The checking is worth being precise about. We ran four verification procedures against the equilibrium, and three of them share the model's own first-order condition — only a brute-force grid search over deviations does not. Together they establish that our solver correctly solves the stated game. They do not establish that the game describes reality.

The assumptions doing the most work are worth naming, because each one plausibly softens the result:

- **No capital constraint, and linear costs.** Real farming carries fixed infrastructure costs and convexity at scale from liquidity limits and detection risk. Convexity erodes the cheapest player's advantage as it scales, and is the leading candidate for real-world concentration being milder than a median 5 to 18 out of 5,000.
- **Complete information and simultaneous moves.** Cost uncertainty softens the sharp active/inactive cutoff into a smoother participation margin.
- **Risk neutrality.** Risk-averse participants under-invest, which would show up as dissipation below the modelled band.
- **A fixed dollar prize.** If heavy farming and subsequent selling depress the token price, the prize depends on the outcome of the contest being modelled, and realised capture is lower than modelled for everyone including the top operator.
- **Caps modelled as higher marginal cost.** A hard quantity ceiling is a different object — a corner constraint on individual effort — and a binding one plausibly does interact with the active-set logic by stopping the top farmer scaling.

The model makes a sharply falsifiable prediction: the share of allocated supply going to the top ten recipients, which is public for completed programs. It predicts roughly 25% to 66% for the top recipient alone at wide dispersion. Testing it is the obvious next step and we have not done it. A measured top-10 share in the low single digits across several programs falsifies the mechanism as the dominant force.

## What we do with it

Suwappu's own [seasons program](/pricing) denominates points in fees paid rather than volume, which follows directly from the result above and means points are not diluted by wash trading. Engagement bonuses are kept small and capped specifically to avoid recreating the per-wallet incentive described here.

We should apply the model to ourselves as well as to others: it says our program concentrates too, and we do not claim an exemption. The design decision it supports is about where dissipated value lands, not about whether a distribution ends up broad.

If you are launching an incentive program on top of our [API](/docs) or [agent surface](/agents), the practical summary is short. Denominate in fees, not volume. Do not add per-wallet floors. Do not expect caps to reduce farming. And model the outcome as an allocation to a handful of professional operators, because that is what the equilibrium predicts.

## Data and code

**[The full working paper, the exact equilibrium solver, the Monte Carlo and the verification suite are published here](/research/replication)**, seeded with a fixed RNG so every number above is reproducible bit-for-bit. No network access is required to re-run any of it.

This post is an abridgement. [The paper](/research/replication/papers/points-tullock-contests.md) carries the propositions and their proofs, the full robustness section and the references — and where the two disagree, the paper governs.

---

*Disclosures: this is research, not investment advice. Suwappu operates a points program of the type analyzed here, and the design this work recommends is the one we ship — treat that as an interested party's claim and check the argument rather than the source. Points-to-token conversion in our program is gated to a future token event and has not occurred, so no outcome data from it informs any result above.*`;

const AIRDROP_BODY = `# We tested our own airdrop model against 330,000 real allocations. It failed.

Last week we published a theory paper modelling points programs as Tullock contests. Its sharpest prediction: a pro-rata pool gets captured by a handful of operators — a median top-1 share of 17-41% and five to eighteen active participants out of thousands. It also named the public variable that would falsify it: recipient-level concentration at completed programs. We went and measured that variable, had the measurement adversarially refereed (which caught a missing distributor and killed our favorite coincidence — both corrections are in the released data), and this is the result. It is the falsification branch.

## The data

**Hyperliquid's HYPE genesis** is the cleanest allocation dataset in the industry: 31% of supply credited pro rata to point-holders automatically, no claim transaction, no exchange distribution at genesis. One free API call returns all 90,918 addresses; excluding six system accounts, the books close to the cent against published tokenomics (user pool + undistributed genesis + assistance fund + a $5k residual = exactly 310.12M = the announced 310M + the 0.012% HIP-2 bucket), leaving **90,912 recipient wallets holding 269.6m HYPE**. Honesty note: this is the *post-enforcement* allocation — about 13% of the announced pool never reached users, because eligibility, sybil and jurisdiction filters ran before genesis. That filtering *raises* measured concentration, toward the model we reject, so the rejection does not lean on it.

**EigenLayer's EIGEN Season 1**: every transfer out of both real distributor contracts — Season 1 ran in two phases, and our first collection missed the second, a defect the referee pass caught via a conservation check we now publish (each distributor's seed equals its claims plus its forfeiture sweep, to the cent) — giving **239,035 wallets, 101.1m EIGEN**, merged per wallet across phases. Claims data cut two ways and we state both: unclaimed small allocations are invisible (biasing concentration toward the model), but EIGEN's geo-restrictions could also have censored a large barred claimant, so we lean the top-1 rejection on HYPE, which has no claim step.

**Ethena's ENA Season 1** we first declared unmeasurable — wrongly, twice, and both corrections are in the release. The distribution turns out to enumerate exactly on-chain: four sibling claim contracts, seeded by the same Ethena address, summing to the announced 750M to within dust. Our first collections contained a fake top recipient (the issuer's own 336.6M sweep-back of unclaimed funds) and a 47M coverage hole — both caught by the conservation check (seed = claims + sweeps + residuals) that we now run on every collector. Final vector: **46,198 wallets claimed 407.8M ENA — and 45% of the pool went back to the issuer unclaimed**, against a widely-repeated "96% claimed" figure that does not survive the ledger. ENA is the lowest-resolution datapoint (claim executors may be custodial), and it still lands on the same shape: top-1 5.4%, top-1% 62.7%, Gini 0.904.

## The result

| | Model predicted (matched n) | HYPE measured | EIGEN measured |
|---|---|---|---|
| Top-1 recipient | 15-41% of pool | **0.73%** | **2.40%** |
| Top-10 recipients | ~78-100% | 4.7% | 12.7% |
| Active participants | 5-23 | 90,912 | 239,035 |

The band was recomputed at each program's own entrant count to head off the obvious objection — it barely moves (top-1 16-36%, active set 6-23 at n = 90,913). And the rejection is formal: across fifteen dispersion values spanning the model's entire parameter space, in 3,000 Monte Carlo draws per program, **not one draw jointly produced a top-1 share within a factor of two of the observed one and an active set of even half the observed participation.** The two moments trade off monotonically — make costs near-identical and participation rises toward 20,000 while the top share collapses to 0.03%; add dispersion and the top share recovers as participation dies. The observed pairs are unreachable from anywhere in the parameter space.

## What the allocations actually look like

Not equal — nothing like equal. The top 1% of wallets holds 58.6% of HYPE's pool, 61.3% of EIGEN's, and 62.7% of ENA's — three chains, three activities, three formulas, one shape. HYPE's allocation Gini is **0.947**; EIGEN's, once the flat bonus is stripped to isolate the pro-rata core, is **0.943**. (An earlier draft celebrated those two matching to three decimals; the corrected two-phase EIGEN vector broke the coincidence, which is why we publish corrections — the robust statement is that both sit in the 0.88-0.95 band under any reasonable trim, which is where on-chain wealth distributions live.)

![Lorenz curves for HYPE and bonus-adjusted EIGEN allocations, both bowed extremely far from the equality diagonal with Ginis near 0.95, against the Tullock model's curve, which hugs the floor until a vertical jump at the far right — about twenty wallets owning the entire pool.](/research/airdrop-lorenz.svg "Both programs' allocation curves are unequal like wealth distributions. The model's equilibrium — a vertical line at the extreme right — is a different kind of object entirely.")

That is the Gini of a wealth distribution, not of a contest. The simplest reading, and the one every number supports: **a pro-rata program photographs the capital distribution of its participants.** Points in both programs were earned roughly in proportion to capital deployed — restaked ETH, margin-backed volume. Capital's *marginal* cost is nearly uniform across participants (that is why the backed-out dispersion is ~zero), but capital *endowments* are wildly unequal, and the model has the roles reversed: it assumes unbounded effort at heterogeneous marginal cost, while reality ran bounded budgets at homogeneous marginal cost.

## What survives from the theory, and what we retract

The design results survive untouched, because they are mechanism arithmetic, not equilibrium selection: denominate points in fees rather than volume (it changes who keeps the dissipated value), and never attach per-wallet floors or bonuses (EIGEN's flat bonus was 22.9% of all claimed tokens, and per our own corollary that structure is a sybil incentive — some unknown fraction of its 239,035 wallets exists because of it).

What we retract: "underwrite a points program as an allocation to roughly ten counterparties." The correct statement is that the top percentile of wallets — hundreds to a couple of thousand of them — takes about 60%, and its composition mirrors participant capital. Hundreds of uncoordinated large holders behave differently from ten coordinated operators: less unlock-cliff risk, more persistent drift.

And one prediction this reframing makes that the contest model cannot: because allocation mirrors participant capital, **a program's final concentration is forecastable mid-season from its depositor distribution** — before any token exists. That is a statistic worth monitoring in real time, and we intend to.

## The caveat that could overturn us

All of this is wallet-level. Farmers split across wallets, so measured concentration is a floor on person-level concentration — and if credible clustering ever collapses the top percentile of these programs into a handful of entities, the model's prediction was right and our rejection wrong. We flag that as the single most damaging possibility rather than burying it, with the arithmetic computed: rescuing the model's top-1 band requires HYPE's wealthiest **55 wallets** to be one entity, and rescuing its participation prediction requires ~90,000 wallets to be ~21 people. EIGEN is softer — its top 12-16 wallets merging would reach the band's edge — which is exactly why the top-1 rejection leans on HYPE.

## If you build on Suwappu

If you are launching an incentive program on our [API](/docs) or [agent surface](/agents): denominate in fees, skip per-wallet floors, expect your allocation to mirror your depositor curve, and size sybil enforcement to the floors you chose — on a clean pro-rata core, splitting wallets changes nothing, so detection budgets belong on the bonus structure, not the core. Our own [seasons program](/pricing) follows exactly this design, and this paper's result — concentration will mirror capital regardless — applies to us as much as anyone; we claim no exemption.

## Data and code

**[Both complete recipient vectors, the collectors, the analysis, and the formal test are published here](/research/replication)** — 329,947 recipient rows across the HYPE and EIGEN vectors used for the primary test, the model solver reused verbatim from the theory paper, fixed seeds throughout. This post is an abridgement; [the paper](/research/replication/papers/airdrop-concentration.md) carries the full method, the matched-n bands, the sup-over-σ test and the ENA post-mortem, and where the two disagree, the paper governs.

---

*Disclosures: this is research, not investment advice. Suwappu operates a fee-denominated points program of the class analyzed here; note that this paper weakens the more dramatic claim of our own prior work, and judge the incentive accordingly. We hold no position in HYPE, EIGEN or ENA. No issuer named reviewed this work. All data is public chain state or public APIs, collected 31 July 2026.*`;

export const researchPosts: ResearchPost[] = [
  {
    slug: 'omnichain-dollar-collateral',
    title: 'USDT0 backing reconciliation: separating protocol coverage from issuer risk',
    date: '2026-07-31',
    updated: '2026-08-06',
    category: 'Reserve risk',
    kind: 'research',
    excerpt: 'The documented USDT0 perimeter reconciles to 1.000298x against observed USDT backing at head. That is a protocol-accounting result — not evidence about Tether\'s underlying reserves, redemption capacity, or legal availability.',
    readMins: 13,
    status: 'published',
    paperPath: '/research/replication/papers/usdt0-collateral-reconciliation.md',
    report: {
      path: '/research/reports/accounting-for-an-omnichain-dollar.pdf',
      title: 'Accounting for an Omnichain Dollar',
      subtitle: 'USDT0 token-unit backing, assurance perimeter, and bank-control implications.',
      date: '2026-08-06',
      pages: 9,
      metrics: [
        { value: '1.0003x', label: 'observed token-unit coverage' },
        { value: '~3bp', label: 'measured difference / not a cushion' },
        { value: '20', label: 'direct supply legs at head' },
      ],
    },
    indexFigure: {
      src: '/research/usdt0-corrected-series.svg',
      alt: 'Corrected measured USDT0 coverage series after the canonical Polygon predicate is included.',
      caption: 'The V2 shortfall disappears when the canonical Polygon backing account is included; the complete head snapshot separately reconciles to 1.0003x.',
    },
    keywords: [
      'omnichain stablecoin', 'USDT0', 'stablecoin backing reconciliation',
      'stablecoin issuer risk', 'cross-chain supply accounting', 'stablecoin settlement risk',
      'LayerZero OFT', 'lock and mint bridge', 'bank stablecoin diligence',
    ],
    body: USDT0_BODY,
  },
  {
    slug: 'points-programs-tullock-contests',
    title: 'Points programs as Tullock contests: equilibrium concentration and mechanism design',
    date: '2026-07-26',
    category: 'Mechanism design',
    kind: 'research',
    excerpt: 'A theory paper predicts five to eighteen active operators out of five thousand under heterogeneous costs. A later empirical test rejects that active-set prediction; the mechanism results on fee denomination and per-wallet bonuses remain arithmetic.',
    readMins: 10,
    status: 'published',
    paperPath: '/research/replication/papers/points-tullock-contests.md',
    keywords: [
      'points program design', 'airdrop farming', 'Tullock contest',
      'token distribution', 'sybil resistance', 'rent seeking',
      'incentive program design', 'crypto airdrop economics',
    ],
    body: POINTS_BODY,
  },
  {
    slug: 'airdrop-concentration',
    title: 'Airdrop concentration in observed allocations: testing the Tullock active-set prediction',
    date: '2026-07-31',
    category: 'Empirical test',
    kind: 'research',
    excerpt: 'Complete recipient vectors for HYPE genesis and EIGEN S1 reject the Tullock active-set prediction: observed top-1 shares are 0.7-2.4% against a predicted 15-41%. The corrected collection and formal rejection are released with the paper.',
    readMins: 9,
    paperPath: '/research/replication/papers/airdrop-concentration.md',
    keywords: [
      'airdrop concentration', 'airdrop allocation data', 'Hyperliquid HYPE airdrop',
      'EigenLayer EIGEN airdrop', 'Tullock contest empirics', 'points program design',
      'token distribution Gini', 'airdrop farming',
    ],
    status: 'published',
    body: AIRDROP_BODY,
  },
  {
    slug: 'tempo-fee-payer-0x76',
    title: 'Gasless swaps on Tempo: fee-payer (type 0x76) transactions, as actually implemented',
    date: '2026-07-31',
    category: 'Protocol',
    kind: 'engineering',
    excerpt: 'The two-signature sponsorship flow with its real numbers — 3 sponsored swaps per user, $100/day global, DB-persisted accounting — and two corrections to the original version of this post.',
    readMins: 5,
    status: 'published',
    body: TEMPO_BODY,
  },
  {
    slug: 'best-price-routing',
    title: 'How Suwappu picks a quote: the race, the ranking rule, and its known gaps',
    date: '2026-07-31',
    category: 'Architecture',
    kind: 'engineering',
    excerpt: 'The chain-gated race across our 18 integrated providers, the exact ranking rule, and the two honest gaps — gas is displayed but not netted, and MEV-shielded routing is conditional on fees. An earlier version of this post overclaimed; this one is verified against source.',
    readMins: 6,
    status: 'published',
    body: ROUTING_BODY,
  },
  {
    kind: 'engineering' as const,
    slug: 'hyperliquid-egress',
    title: 'Building HyperLiquid into a bot: HyperUnit, region gating, and egress',
    date: '',
    category: 'Architecture',
    excerpt: 'An engineering story on integrating an on-chain order-book DEX and routing native deposits through HyperUnit without tripping region restrictions.',
    status: 'planned',
  },
  {
    kind: 'engineering' as const,
    slug: 'kms-key-management',
    title: 'Managing hot-wallet keys: KMS envelope encryption and migrating off Fernet',
    date: '',
    category: 'Security',
    excerpt: 'How managed-wallet keys are encrypted at rest with kms_aesgcm_v2, and what it took to migrate legacy records without downtime.',
    status: 'planned',
  },
  {
    kind: 'engineering' as const,
    slug: 'mcp-for-swaps',
    title: 'An MCP server for cross-chain swaps: a safe DeFi tool for agents',
    date: '',
    category: 'Agents',
    excerpt: 'The design of an agent-facing swap surface — tool shape, quote/settlement contract, and the policy guardrails that keep autonomous execution in bounds.',
    status: 'planned',
  },
  {
    kind: 'research' as const,
    slug: 'route-benchmarks',
    title: 'Measured dispersion in production quote races',
    date: '',
    category: 'Benchmarks',
    excerpt: 'The engine began capturing counterfactual routes — every losing quote alongside the winner — on 31 July 2026. When enough production data accumulates, this paper reports the measured gap between best and second-best routes, with the dataset released.',
    status: 'planned',
  },
];

export const publishedPosts = researchPosts.filter((p) => p.status === 'published');
export const plannedPosts = researchPosts.filter((p) => p.status === 'planned');
export function getPost(slug: string) {
  return researchPosts.find((p) => p.slug === slug && p.status === 'published');
}
