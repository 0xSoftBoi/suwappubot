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
    | 'Empirical test'
    | 'Payments control'
    | 'Execution governance'
    | 'Model risk'
    | 'Model validation';
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
  /** Editorial artwork: conceptual, never the quantitative evidence object. */
  heroArt?: {
    src: string;
    alt: string;
    caption: string;
  };
  /** Quantitative evidence visual; used on the index when no editorial art exists. */
  indexFigure?: {
    src: string;
    alt: string;
    caption: string;
  };
  /** Compact assurance label rendered above every published article. */
  evidence?: {
    status: string;
    asOf: string;
    basis: string;
    boundary: string;
  };
  body?: string;
};

const TEMPO_BODY = `# The fee payer as a treasury control surface: sponsored execution on Tempo

*Engineering control note. Revised and source-verified on 8 August 2026 against current main and Tempo's primary specifications. This is a capability review, not evidence that sponsorship is enabled in production.*

Viewed from a wallet, fee sponsorship looks like UX. Viewed from a bank, it is **delegated expense authority**: the account that authorizes movement of the asset can be different from the account that accepts the network-fee liability. That is the more interesting primitive.

The separation creates the possibility of a centrally governed network-fee account for customers, applications, or autonomous agents without giving that sponsor authority over the underlying payment instruction. It can turn a fragmented requirement to keep every transacting account funded for fees into a service-level treasury function. But it only becomes institutionally useful if the sponsor budget is reserved, reconciled to realized receipts, and governed as carefully as any other operating cash account.

"Gasless" is therefore the wrong frame. The fee still exists. Sponsorship changes **who is charged, who is authorized to incur the charge, and where the operating cost is controlled**.

## One primitive, five institutional readings

| Seat | Decision question | Current answer |
|---|---|---|
| Treasury | Can network fees be centralized instead of pre-positioned across every transacting account? | **Mechanically yes.** Tempo separates fee payer from sender; Suwappu configures a sponsor wallet. Realized-cost reconciliation is not implemented. |
| Payments operations | Does a sponsor outage necessarily stop the customer's payment? | **No by design.** The current engine falls back to a user-paid Tempo path, which preserves an execution route but changes who bears the fee. |
| Product / P&L | Can fee sponsorship become a priced or tiered service with per-client chargeback? | **The primitive permits the accounting separation; the current source does not implement or prove that commercial layer.** |
| Technology / operational risk | Are the stated limits hard budget controls? | **Not yet.** Check and record are non-atomic, actual fees are not settled to the ledger, and the configuration namespace is ambiguous. |
| Settlement / risk | Does fee sponsorship establish asset finality, liquidity, or issuer quality? | **No.** It changes fee liability and authorization; those are separate assurance questions. |

The central-bank lens is deliberately narrower still. [CPMI-IOSCO's guidance on applying the PFMI to systemically important stablecoin arrangements](https://www.bis.org/cpmi/publ/d206.htm) treats the transfer function within a broader governance, risk-management, and settlement-finality perimeter. This note does **not** classify Tempo or Suwappu as a systemically important stablecoin arrangement. The useful discipline is the separation of questions: a fee-payer signature can change who owes the network fee without answering when a payment is legally final, whether the settlement asset is liquid, or what credit claim sits underneath it.

## Executive control view

| Control question | Source-verified implementation | Assurance boundary |
|---|---|---|
| Who authorizes the swap? | Sender signs the Tempo transaction; a distinct sponsor counter-signs as fee payer | Two signatures reduce role ambiguity but do not establish production key-governance quality |
| What is sponsored? | Approval and swap calls are batched into one type-0x76 transaction | Atomic call construction is code-verified; runtime success is not measured here |
| What are the policy limits? | 3 sponsored transactions per user, lifetime; $100 estimated sponsor spend per UTC day globally | These are configured policy thresholds, not proven hard financial limits under concurrency |
| Does accounting survive restarts? | Per-user count and daily estimated spend are persisted in the database | Persistence is verified in source; database availability and reconciliation are outside this note |
| What happens if sponsorship fails? | The engine falls through to the normal user-paid Tempo path | Sponsorship failure does not intentionally fail the swap, but the user-paid transaction can still fail on its own terms |
| Which configuration controls the swap path? | Runtime sponsorship reads \`tempo_fee_sponsor_enabled\` and a named sponsor wallet record | A second, similarly named \`tempo_fee_sponsorship_enabled\` / \`tempo_sponsor_address\` configuration pair has no runtime consumer in this source snapshot; the namespace should be reconciled before operational use |
| Is the feature live? | The feature flag defaults to **off** and requires a funded sponsor wallet | **Production enablement is UNVERIFIED**; repository state is not runtime evidence |

![Control map showing sender authorization, a single type-0x76 approve-and-swap transaction, sponsor fee authorization, and the current policy-control boundary.](/research/tempo-fee-payer-control.svg "Implementation verified in source; production enablement remains unverified. Current limits are policy thresholds, while reservation and realized-fee settlement remain control gaps.")

That final distinction is the most important correction to the original version of this note. A built path, a passing test, and a production-enabled control are three different evidence states.

## The strategic value is cost-account separation, not a free transaction

For a treasury team, the operational problem is not the absolute size of a single network fee. It is the need to provision, authorize, monitor, and reconcile fee balances across every account that may need to move money. A fee-payer primitive changes the topology of that problem: asset authority stays with the sender while the network-cost account can be centralized.

That creates three possible institutional benefits **if** the control layer is completed: less fee-token inventory stranded across user accounts; one place to apply client or service-level sponsorship policy; and receipt-level unit economics that can support internal chargeback or product pricing. None of those benefits is measured in this note, and the current implementation does not yet produce the realized-fee ledger needed to prove them.

The distinction matters because a bank should not confuse a protocol primitive with an operating model. The primitive supplies separated signatures. The operating model still needs entitlement, budget reservation, key governance, reconciliation, exception handling, and evidence that the production configuration matches the approved policy.

## Protocol mechanism: two authorization domains, one transaction

[Tempo's transaction specification](https://docs.tempo.xyz/docs/protocol/transactions/spec-tempo-transaction) defines type **0x76** with native fee sponsorship: a third-party fee payer can pay fees for a sender. [Tempo's fee specification](https://docs.tempo.xyz/docs/protocol/fees/spec-fee) makes the fee token part of the fee-payer commitment. The protocol therefore separates payment authorization from fee authorization without requiring an ERC-4337 paymaster contract.

Suwappu constructs the transaction through the official \`pytempo\` SDK. The sender signs the sender hash; the sponsor signs the fee-payer hash after the fee token is set. The current path batches \`approve(DEX, amount)\` and \`swapExactAmountIn(...)\` as two calls in the same Tempo transaction before broadcast. For the sponsored path, there is no separate on-chain approval transaction to pre-fund.

This does **not** mean a sponsored swap is free. The user's network-fee debit is zero because the sponsor pays it; swap fees, spread, and slippage remain economic costs of the trade.

## The limits are persistent, but they are not a ledger-grade budget control yet

The implementation persists sponsorship state in \`tempo_sponsorships\`: one row per user carries the lifetime transaction count and the UTC-day spend accumulator. That fixes an earlier design in which process restarts could reset counters.

Two control limits remain important for a bank-grade reading:

- **Budget accounting uses a fixed estimate, not realized fee receipts.** After broadcast the engine records **$0.001** against the sponsorship budget. Tempo's protocol documentation says the base fee is calibrated so a TIP-20 transfer costs less than $0.001, but an approve-plus-swap transaction is not a TIP-20 transfer and the code does not reconcile the booked estimate to the actual fee paid. The current $100 figure is therefore an **estimated-spend policy limit**, not a realized-cost cap.
- **Check and record are separate operations.** Eligibility is read before the on-chain transaction and the counter is incremented after broadcast. Concurrent requests can observe the same remaining allowance before either records its spend. Without an atomic reservation, the three-transaction and daily-budget thresholds should not be described as mathematically hard under race conditions.

The scale check makes the first problem easier to see. At the code's fixed **$0.001 booking amount**, a $100 daily counter is arithmetically equivalent to **100,000 booked units** before the global counter reaches its threshold. That is not a throughput claim: the per-user limit, traffic, balances, chain capacity, failures, and actual fees all bind independently. It is simply why the word *budget* should not be read as a reconciled $100 cash ceiling. The counter is only as accurate as the estimate posted into it.

There is also a **configuration-governance issue** to remove before operational reliance. Current source declares both \`tempo_fee_sponsor_enabled\` and \`tempo_fee_sponsorship_enabled\`. The executable swap sponsorship service reads the former; a repository-wide runtime search finds the latter and \`tempo_sponsor_address\` only in settings, tests, and the capability manifest, not in the swap execution path. An operator can therefore set a plausible-looking sponsorship flag that does not activate this control. The appropriate remediation is one canonical enablement variable, one documented sponsor-key source, and a boot-time assertion that the configured control plane matches the executable one.

Those gaps do not invalidate sponsorship. They define the next control step: reserve budget atomically before signing, settle the reservation to the receipt's actual fee, and monitor reservation/settlement exceptions.

## Stablecoin fees reduce one treasury dependency; they do not remove treasury controls

[Tempo's current fee specification](https://docs.tempo.xyz/docs/protocol/fees/spec-fee) documents stablecoin-denominated network fees, avoiding the need for a separate volatile native gas asset. Its [performance documentation](https://tempo.xyz/developers/performance) scopes the sub-$0.001 statement to a standard TIP-20 transfer; that is why this note does not apply the figure to Suwappu's approve-plus-swap call bundle. Suwappu currently configures \`pathUSD\` as the sponsorship fee token. For an agent or treasury workflow, that removes one funding dependency but introduces another: the sponsor wallet must remain funded in an eligible fee token and its authorization must be governed separately from users' spending authority.

A useful operating model is therefore:

| Layer | Required control |
|---|---|
| Sender authority | User or scoped access key signs only the intended call set |
| Sponsor authority | Separate sponsor key signs only permitted fee-payer transactions |
| Budget | Atomic reservation, realized-fee settlement, daily exception reporting |
| Availability | Explicit behavior when sponsor key, balance, database, or Tempo RPC is unavailable; fail boot on ambiguous sponsorship configuration |
| Evidence | Receipt-level reconciliation linking user intent, sponsor authorization, fee token, actual fee, and final status |

## Evidence ledger

The protocol claims in this note come from Tempo's [type-0x76 transaction specification](https://docs.tempo.xyz/docs/protocol/transactions/spec-tempo-transaction), [fee specification](https://docs.tempo.xyz/docs/protocol/fees/spec-fee), and current [performance documentation](https://tempo.xyz/developers/performance). The institutional control framing uses [CPMI-IOSCO's stablecoin PFMI guidance](https://www.bis.org/cpmi/publ/d206.htm) only as a risk-separation lens; it is not a classification of Tempo or Suwappu.

The implementation claims are source observations from current Suwappu main: the sponsorship policy service, Tempo swap construction, keychain, settings, persistence model, and their call sites. Repository state can establish what software is written to do. It cannot establish a production feature flag, sponsor balance, key-control procedure, receipt population, realized fee, uptime, or legal settlement status. Those remain outside this note until runtime evidence is collected.

## Deployment conclusion

The code supports the mechanism and the protocol supports the primitive. The source snapshot does **not** prove that the feature is enabled for users today: \`tempo_fee_sponsor_enabled\` defaults to false, and this review inspected no production flag, sponsor balance, or receipt sample. For that reason the correct status is **implementation verified; production enablement unverified**.

That is also the reason we no longer use "gasless" as the headline claim. For an institutional audience, the economically relevant statement is narrower and more useful: **Tempo can separate transaction authority from network-fee liability; Suwappu has implemented that path with persisted policy limits, but the current spend control still needs atomic reservation and actual-fee reconciliation before it should be treated as a hard treasury budget.**
`;

const ROUTING_BODY = `# A router is an execution policy: price, evidence quality, and the TCA gap

*Engineering control note. Revised and verified against current main on 8 August 2026. This describes Suwappu's decision function; it does not claim regulatory "best execution" or prove superior realized execution.*

An aggregator is a list of connectivity. A router is a **policy for making a financial decision under time pressure and imperfect evidence**. That distinction is the institutional story.

The important questions are not how many logos appear on a page. They are: **what population is eligible for this order, what objective chooses the winner, which inputs are trusted enough to enter that objective, which risks are constraints rather than prices, and what evidence exists after execution?** Current source gives a materially different answer from the previous version of this note.

## "Best" changes with the seat making the decision

| Seat | What good execution means | What current source proves |
|---|---|---|
| Execution desk | Maximize economic output from the eligible comparison set | Gross output is always usable; trusted gas can be netted; provider time can break a close cross-chain race |
| Treasury | Avoid tying up value for longer than the price improvement justifies | Time enters only through a fixed 10bp / greater-than-2x speed rule; no explicit liquidity-at-risk value is calibrated |
| Market / venue risk | Do not accept an economically attractive route whose bridge, venue, or finality risk breaches appetite | Those risks are **not** terms in the current ranking objective and need separate eligibility controls |
| Operations | Prefer routes that actually complete, not merely quote well | Realized failure, revert, and finality outcomes are not yet joined into published selection analytics |
| Model governance | Know which data, fallback branch, and policy version produced the decision | The engine has explicit trust gates and route-comparison telemetry; full outcome validation remains the gap |

The wholesale-FX analogy is useful as governance vocabulary, not as regulatory mapping. The [FX Global Code](https://www.globalfxc.org/fx-global-code/) describes global good-practice processes for a robust, transparent wholesale market supported by resilient infrastructure and explicitly says it does not itself impose legal or regulatory obligations. The transferable idea is that competitive price is one part of execution quality; policy, disclosure, resilience, and post-trade evidence sit around it. This article does not claim the Code applies to these routes.

## Executive finding

Suwappu's generated roster contains **${stats.routerCount} integrations**: ${stats.routers.join(', ')}. No order races all ${stats.routerCount}. Eligibility is chain-, asset-, credential-, fee-, and route-specific.

Once valid quotes return, the Python execution engine uses a **hierarchical decision rule**:

1. Exclude Wormhole's placeholder 1:1 quote from competition unless it is the only quote.
2. If every candidate has trusted gas, at least two usable output-USD observations support a median output price, and the price/gas sanity checks pass, rank on **quoted output less gas converted into output-token units**.
3. If any required trust condition fails, fall back to **gross quoted output** rather than pretend an unreliable gas estimate is precise.
4. For cross-chain routes only, a faster route may replace the value winner if both time estimates are provider-reported, its score is within **10bp**, and its estimated time is **less than half** the winner's.

Ten basis points is **0.10%**. As a scale reference—not a claim about any observed Suwappu order—that is $100 on $100,000 of route value, $1,000 on $1 million, and $10,000 on $10 million. A fixed 10bp speed concession therefore becomes economically material as notional rises; without a calibrated value-of-time function, the present tiebreak is a policy heuristic rather than an estimated optimum.

![Decision waterfall showing the returned quote set, evidence-quality gate, net-of-gas ranking or gross-output fallback, trusted-time cross-chain tiebreaker, and the remaining ex-post transaction-cost-analysis gap.](/research/routing-decision-waterfall.svg "Selection objective depends on evidence quality: trusted inputs permit net-of-gas ranking; otherwise the engine falls back to gross quoted output. Realized execution still requires ex-post measurement.")

That is materially different from both previous versions of this article. Gas is now conditionally netted, and time can now affect the cross-chain winner. The control is deliberately conservative about when those inputs are trusted.

## The router count is a capability perimeter, not competition depth

The generated roster is useful for inventory control, not for measuring competition on an individual order. Same-chain EVM, cross-chain stablecoin, Solana, Tron, Starknet, Tempo, GOAT, and Citrea paths enter different branches. Credentials and feature flags remove additional providers; CoW and Socket are excluded from fee-charging races because their current adapters cannot carry Suwappu's platform-fee parameter.

The relevant statistic for execution quality is therefore **eligible quotes returned per order**, not the number ${stats.routerCount}. The engine uses a 3-second fast window, extends to 8 seconds when no valid quote arrives, and grants up to 0.75 seconds of grace when exactly one quote has arrived. Once at least two valid quotes are in hand, remaining tasks are cancelled. That latency policy is part of the routing outcome even though it is not expressed as a price term: a slower venue can be absent from the comparison set.

For a bank, that also turns provider inventory into a third-party criticality question rather than a marketing count. The [US banking agencies' interagency guidance on third-party relationships](https://www.occ.treas.gov/news-issuances/bulletins/2023/bulletin-2023-17.html) is lifecycle- and risk-based: relationships should be managed in proportion to their risk and criticality. This note does not assert that guidance applies to Suwappu. It is the useful diligence lens: a provider that can determine whether or how funds move should be governed by its order-level role, substitutability, failure mode, and monitoring evidence—not by whether its logo is present in the integration roster.

## Ranking hierarchy and fallback conditions

| Decision input | Used in selection? | Control treatment |
|---|---|---|
| Quoted destination amount | **Yes** | Gross-output fallback and basis for net score |
| Provider / pool fees embedded in output | **Indirectly** | Reflected to the extent the adapter's quoted output is fee-inclusive |
| Gas cost | **Conditionally** | Netted only when every raced quote's gas is marked trusted and price sanity gates pass |
| Output-token USD price | **Conditionally** | Requires at least two provider observations; outliers beyond 0.5x–2x the raw median are discarded |
| Independent input price | **Control input** | Provider-vs-oracle disagreement above 25% forces gross-output fallback |
| Cross-chain duration | **Tiebreak only** | Both estimates must be provider-reported; candidate must be within 10bp and <50% of winner time |
| Realized fill / slippage | **No, not knowable at quote time** | Must be measured ex post |
| Failure rate / finality / bridge risk | **Not in objective** | Requires separate execution-quality and risk controls |

The fallback is a feature and a limitation. It prevents a heuristic gas number from steering funds as if it were audited cost data. It also means two economically identical races can use different objectives depending on data quality. Institutional monitoring should therefore record **which ranking branch fired**, not just which provider won.

## The next institutional step is risk-adjusted routing, not a larger router count

A bank-grade execution objective would normally distinguish **economic score** from **risk eligibility**. One useful design target is to think about a route's decision value as quoted economics less network cost, expected failure cost, the opportunity cost of value in flight, and any explicit risk charge. Some risks may belong outside the score entirely as hard eligibility constraints.

That is a design frame, **not the algorithm Suwappu runs today**. Current code conditionally prices trusted gas and uses a narrow time tiebreak; it does not estimate expected loss from route failure, attach a shadow price to settlement time, or risk-weight bridges and venues. Pretending those terms were quantified would create more false precision, not better execution.

The practical roadmap is therefore measurable: version the approved venue/bridge set; join quote decisions to realized receipts; estimate failure and time distributions by path; decide which risks are hard exclusions versus priced trade-offs; then validate the policy out of sample. Only after that can a routing benchmark say something about realized execution quality rather than quote-stage selection.

## MEV protection is an eligibility property, not a universal routing claim

[CoW Protocol documents](https://docs.cow.fi/cow-protocol/concepts/benefits/mev-protection) its intent/batch-auction design and solver competition as MEV protection. Suwappu can race CoW on eligible same-chain EVM swaps, but the current adapter cannot carry Suwappu's platform fee. When a platform fee is charged, CoW is removed from the selectable set and fetched only as a comparison-only counterfactual when it returns in time. A fee-charged order should therefore **not** inherit a blanket "MEV-protected by CoW" description.

The same discipline applies to every venue-specific protection: capability is not coverage. The order-level record needs to identify which route actually won and which protections were actually present.

## Quote competition is not the same as best execution

The engine emits structured \`route_comparison\` telemetry for multi-quote Python races, including winner, quoted output, gas, fees, estimated time, basis-point delta, and any speed tiebreak. The TypeScript agent/web path separately samples and persists LI.FI route candidates; on same-chain EVM it also fetches KyberSwap for comparison, while execution remains LI.FI. Solana uses Jupiter. That means the agent surface does **not** inherit the Python engine's multi-provider winner selection.

These datasets are useful for transaction-cost analysis, but they do not yet justify a "best execution" claim. Quote-stage counterfactuals answer **selection** questions. [The BIS Markets Committee's study of FX execution algorithms](https://www.bis.org/publ/mktc13.pdf) is useful implementation guidance here: its TCA discussion emphasizes accurate timestamps through the trade lifecycle, a relevant benchmark, price slippage and market impact, rejected trades, and measurements before, during, and after execution. We borrow that measurement discipline, not the FX regulatory perimeter.

A defensible cross-chain TCA record would preserve four layers rather than collapse them into one "best route" field:

| Layer | Minimum record | What it can answer |
|---|---|---|
| Decision snapshot | Request time, eligible providers, every returned quote, objective branch, gas/price trust flags, policy version | What information and rule selected the route? |
| Submission | Signed/submitted time, route and bridge, quoted min-out, expected gas, expected duration | What did the user actually authorize? |
| Outcome | Final status, realized destination amount, realized gas, finality time, retries/re-quotes, exceptions | What did execution actually cost and deliver? |
| Benchmark | Timestamped reference price and a declared comparison rule | How far did realized economics deviate from a reproducible benchmark? |

The benchmark has to be declared before looking at results. The best returned quote is a valid **ex-ante selection benchmark** but not an observed counterfactual fill: the routes that lost were never executed, so their realized price, gas, failure state, and finality are unknowable. That distinction prevents a common TCA error—calling quoted alternatives realized savings.

With those records, the first publishable study should report the distribution, not a single average: eligible-quote depth; chosen-versus-best-quoted basis points; realized-versus-authorized output; realized gas; failure/retry rate; and time to finality by route class. Outliers and fallback-branch frequency belong beside the headline median because the current engine deliberately changes objective when evidence quality changes.

The [December 2024 FX Global Code](https://www.globalfxc.org/fx-global-code/) and the BIS study both make the same higher-level point: execution quality lives inside disclosure, controls, monitoring, and post-trade evidence. This article applies that operating principle without asserting that wholesale-FX rules govern crypto routing.

## Evidence ledger

The external sources are primary or standards-body materials: the current FX Global Code; the BIS Markets Committee execution-algorithm study; the US banking agencies' [third-party risk guidance](https://www.occ.treas.gov/news-issuances/bulletins/2023/bulletin-2023-17.html); and venue documentation where a venue-specific protection is described. The executable findings come from current Suwappu main, including the quote race, evidence gates, comparison-only routes, timeout/grace policy, cross-chain speed tiebreak, and route-comparison telemetry.

The boundary is equally important: this review did not replay production orders, observe a counterfactual fill, establish a consolidated reference price, or measure realized failure/finality distributions. Until those records are joined, the strongest supported claim is **source-verified selection policy**—not realized best execution.

## Control conclusion

The current ranking logic is stronger than the version this article previously described: it conditionally internalizes trusted gas and can trade up to 10bp of value for a greater-than-2x improvement in trusted cross-chain time. Its principal limitation is no longer "gas is ignored." It is **evidence heterogeneity** — the decision falls back when cost or price inputs cannot be trusted, and the system has not yet published a realized-execution benchmark proving the economic effect of those choices.

For a banking audience, that is the appropriate claim boundary: **source-verified execution policy, not certified best execution; evidence-conditioned decision logic, not a universal objective; quote-level counterfactuals, not yet realized TCA; venue-specific protections, not universal coverage.**
`;

const LATENCY_BODY = `# What is a minute of cross-chain execution worth? Pricing latency without confusing ETA for finality

*Quantitative policy-calibration paper. Published 8 August 2026. The routing rule is source-verified, the financing scenario is reproducible and independently checked with Wolfram, and the realized production value of speed remains unmeasured.*

Suwappu's current cross-chain router can spend **up to 10 basis points of winner score** to take a sufficiently faster route. That is an intelligible control: the value winner can lose only when both timing inputs are trusted, the alternative's provider ETA is less than half the winner's, and the score concession remains inside a hard ceiling.

But what is 10bp actually paying for?

One tempting answer is the time value of money. The arithmetic rejects that explanation at minute horizons. Using the latest SOFR observation available when this paper was written — **3.65% for 6 August 2026** — and the New York Fed's ACT/360 money-market convention, **10bp equals 9.863 days of simple financing carry**.

Five minutes of that carry is only **0.003520bp**. The current 10bp ceiling is **2,840.55×** larger.

That is not evidence that speed is worthless. It is evidence that, if an execution policy pays basis points for minutes, **cash carry is not the economic story doing the work**. Market exposure, failure and retry cost, liquidity exceptions, operational deadlines, or explicit service-level preference must supply the rest — and they should be measured rather than hidden inside a universal constant.

## The result in one table

| Minutes saved | 3.65% simple carry | 10bp / carry | Annual simple rate implied by full 10bp | Carry on $1m score value |
|---:|---:|---:|---:|---:|
| 1 | 0.000704bp | 14,202.74× | 51,840% | $0.07 |
| 5 | 0.003520bp | 2,840.55× | 10,368% | $0.35 |
| 10 | 0.007041bp | 1,420.27× | 5,184% | $0.70 |
| 30 | 0.021123bp | 473.42× | 1,728% | $2.11 |
| 60 | 0.042245bp | 236.71× | 864% | $4.22 |

![Log-scale calibration chart showing that the 10bp policy ceiling is 14,203 times one minute of simple SOFR carry, 2,841 times five minutes, 1,420 times ten minutes, 473 times thirty minutes, and 237 times sixty minutes.](/research/latency-carry.svg "At 3.65% SOFR on ACT/360, 10bp equals 9.86 days of simple carry. The chart is generated from the released CSV by the released Python script.")

At a hypothetical **$1m USD-equivalent winner-score value**, five minutes of simple SOFR carry is about **$0.35**; the full 10bp concession is **$1,000**. The conclusion is not that a five-minute improvement can never be worth $1,000. It is that roughly $999.65 of that willingness to pay would need an explanation other than the modeled financing carry.

The result is not sensitive to fine precision in today's rate. Even at a 10% annual simple funding rate, accumulating 10bp takes 3.6 days. At an extreme 100% annual rate, it still takes 8.64 hours. Minute-scale carry simply lives at a different order of magnitude.

## What the router actually does

The implementation claim is narrower than "Suwappu pays 10bp for speed." In the immutable [source snapshot](https://github.com/0xSoftBoi/suwappubot/blob/52d901923a725e7440693ba050733def13d71895/bot/services/swap_engine.py#L492-L589), the cross-chain tiebreak starts only after a value winner has been selected.

For winner score **S_w**, faster-candidate score **S_f**, and their trusted provider ETAs **T_w** and **T_f**, the economic part of the gate is:

**T_f < T_w / 2** and **0 <= (S_w - S_f) / S_w <= 0.001**.

Three boundaries matter.

**10bp is relative to winner score, not automatically input notional.** The underlying score can be net of trusted gas when the pricing evidence supports that conversion, or gross output when it does not. Dollar examples in this paper therefore introduce **V**: the USD-equivalent economic value of the winner score under a credible contemporaneous mark. A $1m input is not asserted to create a $1,000 speed budget.

**"Trusted time" describes provenance, not forecast accuracy.** The current code permits provider-reported timing for the tiebreak and excludes several hard-coded adapter durations. That is a useful trust boundary; it is not an empirical test that the providers' ETAs predict the defined completion endpoint.

**The threshold is a heuristic, not a fitted optimum.** Exactly half the winner ETA does not qualify; just under half can. 10.01bp does not qualify; 10bp can. Deterministic cutoffs are easy to audit, but their existence is not evidence of optimality.

## The minimal financing model

Let **V** be the USD-equivalent winner-score value, **Δt** the minutes saved, **r** the annual simple funding rate and **b = 0.001** the policy ceiling. With 360 days, or 518,400 minutes, in the money-market year:

- policy concession = **b × V**;
- financing carry = **V × r × Δt / 518,400**; and
- cap / carry = **b × 518,400 / (r × Δt)**.

The value **V** cancels from the ratio. At **r = 0.0365**, the time needed for financing carry alone to reach 10bp is **0.001 × 360 / 0.0365 = 9.8630137 days**.

The [New York Fed](https://www.newyorkfed.org/markets/reference-rates/sofr) defines SOFR as a broad measure of overnight Treasury-secured cash-borrowing cost and publishes it each business day. Its [reference-rate methodology](https://www.newyorkfed.org/markets/reference-rates/additional-information-about-reference-rates) applies actual calendar days over a 360-day year to SOFR averages and the index. The 3.65% 6 August observation is available in [FRED](https://fred.stlouisfed.org/series/SOFR), whose series source is the Federal Reserve Bank of New York.

SOFR is used here as a reproducible benchmark. It is **not** Suwappu's disclosed funding cost, a user's opportunity cost, a bridge risk premium, or a universal institutional hurdle rate.

## Speed is not finality

An ETA field should not quietly become a settlement-risk field.

The [CPMI glossary](https://www.bis.org/cpmi/glossary.pdf) defines final settlement around irrevocable and unconditional transfer or discharge at a legally defined moment. [PFMI Principle 8](https://www.bis.org/pfmi/help/principleid.htm) separately emphasizes clear and certain final settlement, with intraday or real-time settlement where needed or preferable. A bridge provider's expected duration can be operationally useful without proving either concept.

The distinction also matters in conventional markets. The BIS's June 2026 analysis of the 2025 Triennial Survey reports that **90% of average daily FX settlement used methods that eliminate or mitigate settlement risk while 10%, about $1.4tn, remained exposed through gross bilateral settlement**. It also distinguishes principal settlement risk from replacement-cost and liquidity risk even under payment-versus-payment ([BIS Quarterly Review](https://www.bis.org/publ/qtrpdf/r_qt2606c.htm)). That is wholesale-FX evidence, not a claim that its rules apply to crypto bridges. The transferable lesson is that **settlement method and elapsed time are separate risk dimensions**.

The [FSB's G20 cross-border-payment targets](https://www.fsb.org/work-of-the-fsb/financial-innovation-and-structural-change/cross-border-payments/g20-targets-for-enhancing-cross-border-payments-2/) make the endpoint explicit in another way: wholesale speed is measured to crediting, with reconciliation tracked separately. Again, this is measurement discipline, not a regulatory mapping to Suwappu.

For this reason the field examined here should be called what the source proves: **provider-reported route-duration evidence**. Legal or policy finality needs its own definition.

## What can justify paying more than carry?

A complete speed value can contain several terms:

| Component | What must be measured |
|---|---|
| Cash carry | Funding benchmark × economic value × time saved |
| Market exposure | Difference in conditional implementation shortfall between route choices |
| Failure / retry | Failure probability, retry time, realized repair and re-quote cost |
| Liquidity / operations | Deadline misses, stuck-balance duration, exception workload, liquidity reuse |
| Service-level value | Explicit user or treasury willingness to pay for a documented deadline |

Only the first term is estimated here. The others can be larger; the paper has no production outcome sample with which to say how large.

That is why the right implementation is not "replace 10bp with SOFR carry." It is to turn the heuristic into a **versioned willingness-to-pay curve** whose non-carry terms have evidence behind them.

## A bank-grade calibration path

**1. Keep route risk as an eligibility control.** Supported asset and chain, approved bridge/provider class, transaction limits, security requirements, compliance policy and the acceptable completion/finality definition should decide whether a route may compete. A fast ETA should not buy through a hard risk limit.

**2. Preserve the exact economic decision.** Give every quote race a durable decision ID and policy version. Store every returned quote, raw and net score, gas/price trust flags, timing provenance, the initial winner and the candidate's score concession. Convert that concession to USD only when the output price is credible.

**3. Join the outcome.** Persist decision, submission, usable-funds and separately defined finality timestamps; realized output and fees; failure/retry state; and a predeclared market benchmark. The [BIS Markets Committee's execution-algorithm study](https://www.bis.org/publ/mktc13.pdf) is useful methodology by analogy: its TCA discussion centers accurate lifecycle timestamps and outcome measures such as slippage, market impact and rejected trades.

**4. Validate the ETA itself.** Report median and tail ETA error, percentile coverage, failure and retry distributions, and time-to-usable-funds by route class and relevant size band. "Provider-reported" should be the beginning of the trust test, not the end.

**5. Shadow before steering.** A candidate calibrated policy can run on the same quote races without changing winners. Only after predeclared outcome-coverage and timestamp-quality checks pass should it acquire steering authority.

A conservative control template is:

**allowed speed premium = min(10bp, carry + measured approved risk premium + explicit SLA value)**.

That is a governance equation, not an estimated result from this paper. An unmeasured risk term should not be filled with a guessed number merely to defend the existing ceiling.

## What would change the conclusion

The financing result can be rerun by changing one pinned rate input. The more important conclusion is designed to be challenged by production evidence.

If joined outcomes show that faster trusted-time routes consistently avoid market, failure, liquidity or operational losses worth close to the paid score concession, then the 10bp ceiling has an empirical defense. If the avoided cost is materially lower, the threshold should fall. If provider ETAs do not predict the defined usability endpoint with acceptable error, timing should lose steering authority regardless of provenance.

The question becomes reviewable: **what observed cost or explicit preference pays for each basis point of speed premium?**

## Reproducibility and evidence boundary

The [working paper](/research/replication/papers/settlement-latency-value.md), [standard-library calculation](/research/replication/code/settlement_latency_value.py) and [scenario CSV](/research/replication/data/settlement_latency_value.csv) are public. The script regenerates both the CSV and the figure shown above without credentials or network access. The historical SOFR input is pinned so a future run cannot silently rewrite the result.

The key arithmetic was independently evaluated in Wolfram Language: 10bp / 3.65% × 360 = **9.8630137 days**; the cap-to-carry multiples for 1, 5, 10, 30 and 60 minutes are **14,202.74×, 2,840.55×, 1,420.27×, 473.42× and 236.71×**.

The boundary is equally explicit. This paper uses **no production replay**. It does not measure how often the tiebreak fires, the values of affected orders, actual ETA error, realized savings, route failure, or legal finality. The scenario minutes are a calibration grid, not an empirical latency distribution.

---

*Disclosures: Suwappu builds the cross-chain execution infrastructure whose routing policy this paper critiques. That commercial and authorship interest is why the adverse calibration result, code snapshot, formulas, data and limitations are published rather than reduced to a performance claim. No named route provider reviewed the paper before publication. Wolfram was used as an independent arithmetic check, not as peer review or production evidence. This is research, not investment advice, a legal-finality opinion, a regulatory best-execution determination, or a claim that conventional FX rules apply to crypto routing.*
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

const POINTS_BODY = `# Incentive budgets as market design: what survives after the model fails

*Institutional research note. Revised 8 August 2026. The companion empirical study rejects this model's active-set prediction at wallet level. This revision separates the failed descriptive claim from the conditional mechanism results that remain valid inside the stated model.*

The bank-relevant way to read a points program is not as token marketing. It is a **budget-allocation mechanism**: a sponsor defines a reward pool, a rule turns customer or participant behavior into claims on that pool, and the rule determines who receives the subsidy, what behavior is encouraged, and how much of the economic cost returns to the sponsor versus leaves the system.

The first version of this paper made a strong descriptive claim: model a pro-rata points pool as a linear-cost Tullock contest and cost dispersion will leave roughly five to eighteen active operators out of 5,000. We subsequently tested that prediction against the HYPE genesis recipient vector and the both-phase EIGEN Season 1 claim-recipient vector. Against the matched-program model envelope's roughly 14.3% lower edge, the predicted top share is **19.6× the HYPE observation and 6.0× the EIGEN observation**; participation misses by far more.

That failure changes the paper's decision use. The model remains useful as a **conditional benchmark**; it is not an empirical forecast of program-wide wallet allocation.

## Four ways a financial institution would read the same reward rule

| Seat | Decision question | What this research can actually say |
|---|---|---|
| Product / growth | Does the reward rule buy the behavior and retention we want? | **Not answered here.** The model has effort and prize shares, not attributable retention, balances, payments, or lifetime value. |
| Finance / treasury | How much incentive cost comes back as sponsor revenue versus leaves as external friction? | The fee-denomination result gives a **conditional cost-allocation identity**, not realized program ROI or revenue. |
| Fraud / identity | Does the rule reward economic activity or the creation of more identities? | Strict fee proportionality is wallet-count invariant only in a fixed-budget benchmark; per-wallet bonuses mechanically reopen a splitting incentive. |
| Model risk | Is the model fit for forecasting allocation concentration? | **No on current evidence.** The active-set forecast failed outcome analysis; the model is retained only for bounded comparative statics and mechanism diagnostics. |

This distinction is close to the US banking agencies' [revised 2026 model-risk guidance](https://www.federalreserve.gov/frrs/guidance/supervisory-guidance-on-model-risk-management.htm), which separates model development and use from validation and monitoring, including outcomes analysis, and from governance and controls. We use that framework as an institutional analogy, not as a claim that this research model is itself subject to the guidance. A solver can be correct and a use case can still be wrong.

| Finding | Current evidence status | Appropriate use |
|---|---|---|
| 5–18 active operators / top-1 share 17–41% under sampled heterogeneous costs | **Rejected as a wallet-level description** by the companion HYPE/EIGEN test | Model diagnostic only; do not use as an underwriting forecast |
| Symmetric dissipation \`D(n) = (n-1)/n\` is invariant to a scalar common unit cost | **Valid inside the unconstrained symmetric model** | Comparative statics for the stated game, not a claim about hard quantity caps |
| Moving modeled marginal cost from external friction to protocol fees changes who receives modeled spend | **Model identity** | Mechanism-design direction; not a realized revenue forecast |
| Strictly proportional fee points are invariant to splitting a fixed budget across wallets | **Algebraic under fixed budget and no per-wallet nonlinearities** | Diagnose wallet-splitting incentives in the pro-rata core; not proof of person-level sybil resistance |

The mathematics is standard contest theory. Existence and uniqueness for the asymmetric case are Szidarovszky and Okuguchi (1997); the active-set rule is related to Stein (2002); Cornes and Hartley (2005), Franke et al. (2013), Konrad (2009), and Tullock (1980) provide the theoretical lineage. Our contribution is the application, simulation, and—importantly now—the public record of where the application failed its first field test.

## The setup

Let a fixed prize be split in proportion to points earned, and let points cost something real to acquire — gas, capital lockup, slippage, or protocol fees. Then each participant faces the payoff of a lottery contest: their share of the prize is their share of total effort, minus what that effort cost them.

The symmetric benchmark has one clean comparative-static result. With identical linear costs and no quantity constraint, the dissipated fraction is exactly (*n*−1)/*n*. Holding *n* = 100 and scaling the common unit cost from $0.10 to $100 leaves modeled dissipation at 0.990: points minted fall from 9.9 million to 9,900 while modeled dollar spend remains $990k.

The original article incorrectly promoted that result into a claim about **hard caps**. A scalar increase in marginal unit cost and a binding per-user quantity ceiling are not the same mechanism. A hard cap is a corner constraint on effort; the current heterogeneous-cost model does not solve that constrained game. We therefore retract the sentence "caps change points minted but not dissipation" as a general design claim.

The second benchmark is the active-set result under heterogeneous linear costs. It is mathematically correct for the game we solve. The companion empirical paper shows that it is not a good description of the observed wallet-level allocation process in the programs we tested.

## What happens under sampled cost differences

Solving the equilibrium exactly, for 5,000 potential entrants with no fixed cost of entry and lognormally distributed costs, gives the following. These are medians of 500 independent draws, with the 5th-to-95th percentile band, rather than single runs. σ is the log-standard-deviation of cost per point across participants:

| Cost dispersion | Active operators | Pool as modeled participant surplus | Largest operator's share |
|---|---|---|---|
| σ = 0.2 (mild) | 18 of 5,000 | 9.5% | 17.1% |
| σ = 0.4 (moderate) | 10 of 5,000 | 15.8% | 25.9% |
| σ = 1.0 (wide) | 5 of 5,000 | 29.8% | 40.8% |

Note that these are *lower* dissipation figures than the symmetric 99% above — 70% to 90%. Inside the model, greater cost heterogeneity shifts part of the prize from modeled contest spend to participant surplus. The two scenarios are therefore not comparable line by line.

Within this model, two readings matter. The number of participants who are *active at equilibrium* is single-digit to low-double-digit across the sampled cases, and the share of the pool that is not competed away is modeled as participant surplus. Neither statement is now presented as an empirical description of a named program.

![Two model-output bar charts with error bars: median active operators out of 5,000 falls from 18 to 5 across the sampled cost-dispersion scenarios, while modeled participant surplus rises from about 10 percent to 30 percent of the pool.](/research/points-participation.svg "Model output only, not an empirical forecast. Bars are medians of 500 draws under the stated Tullock specification; whiskers span the 5th to 95th percentile.")

For diligence, Table 1 should now be read as **model output, not a counterparty forecast**. The empirical test found tens to hundreds of thousands of positive-allocation wallets where the model predicted a small active set. Beneficial-owner concentration may be higher than wallet concentration, but that is an entity-resolution question the model does not answer.

## Fee denomination: a conditional revenue-capture result

Within the symmetric linear benchmark, denomination changes where modeled spend lands. That is narrower than saying denomination is the only lever available to a real program.

Split the cost of acquiring a point into the part paid to the protocol as a fee, and the part that leaves the system as gas, bridge cost, or slippage paid to third parties. In this benchmark, total modeled spend is held constant while its destination changes.

![Stacked model-scenario chart comparing four assumed cost decompositions, with modeled protocol revenue rising as the protocol share of marginal cost increases while total modeled dissipation is held fixed.](/research/points-denomination.svg "Conditional model arithmetic: the scenario holds total dissipation fixed and changes its assumed destination. These are not measured or forecast revenues.")

Take the symmetric *n* = 100 example on a million-dollar pool: all four simulated designs hold modeled spend at $990k while changing the assumed share of marginal cost captured by the protocol from 5% to 97%. The resulting protocol-revenue arithmetic runs from $49.5k to $960.3k. Those are scenario outputs driven by the assumed cost split—not measurements of a live program or forecasts of realized fee revenue.

A limit worth stating: as the protocol's share of marginal cost approaches 1, modeled revenue approaches the dissipated amount, not the whole pool. A live program still faces external execution costs and endogenous participation, so the identity does not establish full economic cost recovery.

Stated honestly, the result is a conditional allocation identity: for a fixed modeled amount of contest spend, a larger protocol share of marginal cost routes more of that spend to the protocol. The empirical study invalidates the jump from that identity to a claim that a fee-denominated program must concentrate on the model's active-set terms.

## Wallet splitting: what the algebra does and does not establish

If points are strictly proportional to fees paid, a participant splitting a **fixed aggregate budget** across many wallets earns the same total points in the model. The pro-rata core is invariant to wallet count under that narrow condition. This is not a general claim of sybil resistance: identity-level eligibility, fixed costs, referral graphs, per-wallet limits, bonuses, detection rules, and behavior outside the fixed-budget comparison can all change the incentive.

Now add a per-wallet nonlinearity: a 25% bonus on the first 5,000 points of *each wallet*. That single addition makes splitting profitable in the fixed-budget comparison because a participant can re-trigger the capped bonus once per wallet. A $100k budget split across 1,000 wallets puts $100 in each — well under the threshold — so every wallet earns the full bonus, where a single wallet earns it only on the first 5,000 of 100,000 points.

How much that pays depends on the competing effort the participant faces, so it is a range rather than a single point estimate:

| Competing effort (points) | Gain from 1,000 wallets vs 1 | Under strict fee-proportionality |
|---|---|---|
| 100,000 | 1.104× | 0.0 |
| 1,000,000 | 1.209× | 0.0 |
| 20,000,000 | 1.233× | 0.0 |

The gain rises as the participant's own share of the pool falls, approaching the bonus rate itself. It is a best response against fixed competing effort, not an equilibrium quantity. The supported conclusion is therefore specific: **this per-wallet bonus creates a wallet-splitting incentive that the strictly proportional core does not have in the fixed-budget comparison.** It does not establish the net amount of identity splitting in a live program.

## Empirical status: the sharp prediction failed

This post originally said the model's falsification test—recipient-level concentration at completed programs—had not been run. It now has. The primary HYPE and EIGEN vectors contain 329,947 positive-allocation wallets in aggregate; measured top-1 shares are 0.73% and 2.40% against a program-matched model envelope whose lower edge is about 14.3%. Across the grid test, no sampled parameter value reconciles both observed participation and top-share concentration. [The companion paper reports the collection, correction history, and simulation test.](/research/airdrop-concentration)

What fails is the **descriptive active-set channel at wallet level**. What survives are conditional identities that do not depend on that descriptive fit: the symmetric cost-scaling result, the modeled revenue-capture identity, and the fixed-budget wallet-splitting arithmetic. Even those results inherit their stated assumptions and should not be promoted into claims about hard caps, realized revenue, or beneficial owners.

## Model-risk boundary

The solver has been verified against first-order conditions, inactive-player entry conditions, a brute-force deviation grid, and an independently coded damped best-response process. That establishes that the code solves the stated game. It does not establish external validity; the companion study supplies direct evidence that the active-set description fails for the observed programs.

The main omitted mechanisms are now more than a limitations list; they are candidate explanations for the rejection:

- **Budget constraints and nonlinear costs.** The model gives participants unbounded effort at constant marginal cost. Real users have finite capital and operational limits.
- **Incomplete information and dynamic participation.** Users need not solve a one-shot complete-information Nash game to receive points for activity they would have undertaken anyway.
- **Risk and uncertain prize value.** The token value is unknown while points are earned; the model treats the dollar prize as fixed.
- **Identity resolution.** Wallets are not beneficial owners. Entity clustering can raise economic concentration even when wallet concentration is measured correctly.
- **Hard quantity caps.** A binding cap is a constrained game not solved by Proposition 2's scalar-cost invariance.

The empirical rejection also gives the model a clean governance status: **challenged for descriptive use, retained for conditional mechanism analysis**. Any future claim that the active-set result predicts a live program should require new evidence rather than cite Table 1 by itself.

## Applied design: Suwappu's own incentives

The current source configuration denominates the pro-rata core in fees and also contains per-user engagement and referral caps. Those are two different mechanisms. The fixed-budget wallet-splitting corollary applies to the strictly fee-proportional core; it does **not** certify the nonlinear grants or the entire program as sybil-neutral.

We also do not use repository code as evidence of a realized distribution outcome. No completed Suwappu token allocation is measured in this study. Until outcome data exists, concentration for our own program is **unverified**.

For a program designer or diligence team, the defensible takeaways are correspondingly bounded: make the economic denominator explicit; test per-wallet nonlinearities for splitting incentives; model hard caps as constraints rather than cost scalars; and treat recipient concentration as an empirical variable to be measured, not inferred from this contest benchmark.

For a product or finance owner, there is one additional implication the contest model cannot answer: **reward efficiency has to be measured downstream of the reward.** A program can generate enormous measured activity and still destroy value if the subsidized behavior disappears when the subsidy stops. The relevant operating dataset therefore joins incentive cost to the business outcome the program was supposed to create—retained balance, payment activity, execution, revenue, or another explicitly chosen objective. This paper supplies no such causal ROI estimate, so it should not be used as one.

## Data and code

**[The full working paper, the exact equilibrium solver, the Monte Carlo and the verification suite are published here](/research/replication)**, seeded with a fixed RNG so every number above is reproducible bit-for-bit. No network access is required to re-run any of it.

This post is an abridgement. [The paper](/research/replication/papers/points-tullock-contests.md) carries the propositions and their proofs, the full robustness section and the references — and where the two disagree, the paper governs.

As a reproducibility cross-check, the symmetric benchmark reconciles directly: *D* = 99/100 = 0.99, so a $1m prize implies $990k of modeled spend; at unit costs of $0.10 and $100 that corresponds to 9.9m and 9,900 points, and 5% and 97% capture imply $49.5k and $960.3k. This checks the article's arithmetic; it is **not** model validation or evidence of realized program economics.

---

*Disclosures: this is research, not investment, legal, accounting, or prudential advice. Suwappu has a direct commercial interest in fee-denominated incentive design. No completed Suwappu token distribution is used as evidence here. The active-set prediction in the first version of this article failed its first published wallet-level empirical test; that correction is part of the research record, not a footnote.*`;

const AIRDROP_BODY = `# When a mathematically correct model is wrong: an allocation-model validation case study

*Institutional empirical note. Revised 8 August 2026. This study measures wallet-level allocation concentration; it does not identify beneficial owners, prove a causal mechanism, or make a legal or prudential classification.*

The most useful result in this paper is not an airdrop statistic. It is a model-governance failure caught in public: **the solver passed its internal checks, the theory generated a sharp prediction, and the prediction failed when it met outcome data.** The implementation was right; the descriptive use was wrong.

That distinction is familiar to bank model-risk teams. The US banking agencies' [revised 2026 model-risk guidance](https://www.federalreserve.gov/frrs/guidance/supervisory-guidance-on-model-risk-management.htm) separates development and use from validation and monitoring, including outcomes analysis, and from governance and controls; it also notes that a fundamentally sound model can still create high model risk when misapplied or misused. We use that structure as a reading frame rather than asserting regulatory applicability to this paper.

The prior theory paper predicted that a heterogeneous linear-cost Tullock contest would produce a very small active set and a top recipient holding 17.1–40.8% of the pool in the original 5,000-entrant simulations. Recomputing at the observed HYPE and EIGEN wallet counts moves the primary-program top-share envelope to roughly 14.3–37.0%. We tested that prediction against the HYPE genesis recipient vector and the both-phase EIGEN Season 1 claim-recipient vector, with ENA Season 1 as a lower-resolution cross-check.

The prediction is rejected at wallet level. That conclusion is stronger than the causal story we initially attached to it, so this revision separates the two.

The scale of the miss is worth stating directly. Against the model envelope's roughly 14.3% lower edge, HYPE's measured 0.73% top share is **19.6× lower** and EIGEN's 2.40% top share is **6.0× lower**. The two primary vectors contain **329,947 positive-allocation wallets in aggregate** (90,912 HYPE + 239,035 EIGEN). Those are wallet counts, not resolved beneficial owners, so the comparison rejects the wallet-level forecast without establishing person-level diversification.

## The model-risk reading

| Validation layer | Evidence | Governance status |
|---|---|---|
| Conceptual specification | A standard Tullock contest with heterogeneous linear marginal costs | Coherent for the stated game; material real-world mechanisms are omitted |
| Implementation verification | First-order conditions, inactive-entry conditions, brute-force deviations, and an independently coded best-response check | **Passed** for solving the stated model |
| Outcome analysis | HYPE and EIGEN wallet vectors versus matched-*n* simulated moments | **Failed** for the active-set / top-share descriptive use |
| Use limitation | Conditional mechanism identities do not require the rejected active-set fit | Retain for bounded scenario analysis; do not use as an allocation forecast without new evidence |
| Data / identity risk | Observations are wallets or claim recipients, not resolved beneficial owners | Separate measurement problem; neither the model nor the ledger closes it |

This is why publishing a failed prediction is more valuable than quietly replacing it with a better story. Verification asks whether code implements the model. Validation asks whether the model is adequate for its intended use. Those are different controls.

| Question | Finding | Evidence boundary |
|---|---|---|
| Does the model match top-wallet concentration? | **No.** HYPE top-1 is 0.73%; EIGEN raw top-1 is 2.40% | Observed HYPE allocation plus both-phase EIGEN claim-recipient ledger |
| Does the model match participation at the same parameter values? | **No.** Observed positive-allocation wallet counts are orders of magnitude larger | Wallets are not beneficial owners |
| Are the observed distributions equal? | **No.** Top 1% of wallets holds about 59–63% across the three measured vectors | Concentrated, but in a different shape from the modeled tiny active set |
| Why does the model fail? | **Not identified by this study** | Budget constraints / capital exposure are working hypotheses, not causal estimates |

## The data

**HYPE genesis.** The collector returns 90,918 addresses; after six enumerated system-account exclusions, the analysis contains **90,912 recipient wallets holding 269.6m HYPE**. The accounting reconciliation closes against the published genesis components used by the collector. The vector is post-eligibility: issuer rules operated before distribution, so this paper does not observe the counterfactual pre-filter population. We therefore do not assign a causal direction to those filters without measuring the excluded set.

**EIGEN Season 1.** We aggregate transfers from both distributor phases to **239,035 wallets and 101.1m EIGEN**. The first collection omitted Phase 2; the corrected release adds it and publishes a seed = claims + forfeiture-sweep conservation check for each distributor. [Eigen Foundation's own Season 1 documentation](https://docs.eigenfoundation.org/faq/season-1) confirms the two-phase design and the additional 100-EIGEN per-address allocation. Because unclaimed allocations and eligibility restrictions are not observed symmetrically, HYPE carries more weight in the top-wallet rejection.

**ENA Season 1.** Four sibling claim contracts seeded from the same issuer address reconcile to approximately 750m units. After excluding the issuer's **336.6m** sweep-back from the recipient vector and closing a 47m coverage gap found during review, the released vector contains **46,198 wallets and 407.8m ENA**. We deliberately do **not** equate that ledger reconciliation to public "claimed percentage" figures unless their denominator, time window, and treatment of sweep-backs match ours. ENA is lower-resolution because claim executors may aggregate beneficiaries; it is a cross-check, not equal-quality evidence for the primary test.

## The result

| | Model predicted (matched n) | HYPE measured | EIGEN measured |
|---|---|---|---|
| Top-1 recipient | 14.3–37.0% of pool | **0.73%** | **2.40%** |
| Top-10 recipients | 79.1–100% | 4.7% | 12.7% |
| Active participants | 6–22 | 90,912 | 239,035 |

The model band was recomputed at each program's own entrant count. The grid-based rejection then evaluates 15 cost-dispersion values from 10⁻⁴ to 1.2 with 200 Monte Carlo economies at each value: **zero of 3,000 draws per program jointly produced a top-1 share within a factor of two of the observed one and an active set of at least half the observed wallet count.** Within that prespecified grid, lowering dispersion raises modeled participation while collapsing the top share; increasing dispersion raises the top share while shrinking the active set. No sampled parameter reconciles both moments. The paper reports this as a grid-based simulation test, not proof over every possible alternative model or parameterization.

## What the allocations actually look like

The empirical distributions are still highly unequal. The top 1% of wallets holds 58.6% of HYPE's measured user pool, 61.3% of raw EIGEN claims, and 62.7% of the measured ENA recipient vector. HYPE's wallet-level Gini is **0.947**; EIGEN's bonus-adjusted vector is **0.943**. The important observation is not that these numbers look similar; it is that a distribution with hundreds of thousands of positive-allocation wallets can still be highly concentrated while remaining fundamentally different from the model's handful-of-active-players shape.

From a distribution-risk seat, that produces a second caution: **wide participation is not the same as diversified economic ownership.** A top percentile holding roughly 59–63% is compatible with a very large positive-recipient population. Conversely, wallet concentration is not beneficial-owner concentration. Neither statistic, by itself, estimates secondary-market liquidity, sell pressure, governance control, or loss severity.

![Lorenz curves for the measured HYPE and bonus-adjusted EIGEN wallet vectors compared with the selected Tullock-model benchmark, showing broad positive recipient populations in the observed vectors versus a much smaller modeled active set.](/research/airdrop-lorenz.svg "Wallet-level comparison only. The observed vectors remain highly concentrated, but their distributional shape is materially broader than the selected active-set model benchmark; wallets are not beneficial owners.")

### Interpretation versus identification

A **working hypothesis** is that capital or activity budgets are the omitted constraint. HYPE and EIGEN rewarded activities related to trading or restaking, so an allocation that co-moves with participant capital is economically plausible; a budget-bound pro-rata mechanism can produce many positive allocations with a heavy upper tail. The backed-out Tullock parameter also moves toward very low marginal-cost dispersion when forced to match the observed top share.

The data in this paper do **not** measure participant capital at the relevant snapshots, estimate marginal costs, or randomly vary the reward rule. They therefore do not identify "allocation mirrors capital" as the cause of the observed shape. That hypothesis should be tested by joining future recipient vectors to pre-distribution balance/activity distributions, rather than stated as an empirical fact.

## What survives from the theory, and what we retract

The theory paper's **conditional** mechanism results do not depend on the rejected active-set fit: within its symmetric benchmark, shifting marginal cost toward protocol fees changes the modeled destination of spend; under a fixed aggregate budget, strictly proportional fee points are invariant to wallet splitting. EIGEN's additional 100-token per-address allocation is directly documented by Eigen Foundation and creates a mechanical reason that splitting can matter. This dataset does not estimate how many wallets, if any, were created because of that incentive.

What we retract is the prior instruction to "underwrite a points program as an allocation to roughly ten counterparties." These data support a different measurement statement: the top percentile of **wallets** holds roughly 59–63% in the three measured vectors. They do not establish how many beneficial owners sit behind those wallets, whether those owners are coordinated, or what their future selling behavior will be.

The capital-mirror hypothesis makes a useful prospective test: **if** pre-distribution depositor/activity concentration forecasts final allocation concentration out of sample, it should be measurable mid-season. We have not run that test. It is a research agenda, not a current forecasting result.

## Beneficial-owner resolution is the largest remaining measurement risk

All headline statistics are wallet-level. Wallet splitting can make beneficial-owner concentration **higher** than measured wallet concentration; omnibus or custodial collection can make a single wallet represent many beneficiaries, pushing in the opposite direction. The sign is therefore not known without entity resolution.

We quantify how much clustering would be required to rescue the model rather than assume it away. Using each program's stored σ = 0.2 matched-*n* median as the lower benchmark, the wealthiest **63 HYPE wallets** would have to be treated as one entity to reach 16.1%; the participation moment would require roughly 90,000 wallets to collapse to about 21 entities. EIGEN's top-share result is more sensitive: merging its top **13 wallets** reaches its 14.35% matched median. That asymmetry is why HYPE carries the cleaner top-wallet rejection and EIGEN contributes more through its participation moment.

## Decision use

For model governance, the clean status is **challenged for descriptive forecasting; retained for bounded mechanism analysis**. Reuse of the active-set forecast should require a new population, an explicit intended use, and new outcome evidence rather than pointing back to the solver verification.

For program diligence, the immediate conclusion is negative but useful: do not convert participant headcount into a beneficial-owner diversification claim, and do not use the rejected Tullock active-set result as a substitute. Measure the actual allocation vector, document claim/eligibility filters, reconcile the distributor population, and treat entity resolution as a separate control.

For mechanism design, per-wallet nonlinearities should be tested explicitly for wallet-splitting incentives. Fee denomination may change where modeled activity cost accrues, but this paper does not show that it causes broad or narrow ownership. Suwappu has a commercial interest in that design choice, so our own incentive program is not offered as validating evidence.

## Data and code

**[Both primary wallet vectors, the collectors, the analysis, and the simulation test are published here](/research/replication)** — 329,947 recipient rows across the HYPE genesis and EIGEN claim-recipient vectors used for the primary test, the model solver reused verbatim from the theory paper, fixed seeds throughout. This post is an abridgement; [the paper](/research/replication/papers/airdrop-concentration.md) carries the full method, matched-*n* bands, prespecified grid-based simulation test, and ENA post-mortem, and where the two disagree, the paper governs.

For program-design provenance, the primary external source for EIGEN is the [Eigen Foundation Season 1 documentation](https://docs.eigenfoundation.org/faq/season-1), which documents the two phases and the additional per-address allocation. The outcome quantities above come from the released recipient vectors and collectors rather than from that program document; the distinction between source-defined mechanics and measured outcomes is deliberate.

---

*Disclosures: this is research, not investment, legal, accounting, or prudential advice. Suwappu has a commercial interest in fee-denominated incentive design; this paper rejects a more dramatic concentration claim from our own prior work. We hold no position in HYPE, EIGEN, or ENA taken on the basis of this analysis. No issuer named here reviewed the study. The primary evidence is public chain state or public APIs collected 31 July–1 August 2026, and all headline concentration statistics are wallet-level.*`;

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
    evidence: {
      status: 'MEASURED',
      asOf: '2026-08-01',
      basis: 'Public chain state · code and data released',
      boundary: 'Protocol token-unit reconciliation; not an issuer reserve attestation.',
    },
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
    slug: 'pricing-cross-chain-latency',
    title: 'What is a minute of cross-chain execution worth? Pricing latency without confusing ETA for finality',
    date: '2026-08-08',
    category: 'Execution governance',
    kind: 'research',
    excerpt: 'At 3.65% SOFR, a 10bp speed concession equals 9.86 days of simple ACT/360 carry—not minutes. The paper turns that gap into a falsifiable calibration framework for cross-chain execution, while keeping provider ETA separate from settlement finality.',
    readMins: 12,
    status: 'published',
    evidence: {
      status: 'RESEARCH — SOURCE-VERIFIED',
      asOf: '2026-08-08',
      basis: 'Current router source + NY Fed rate benchmark · code/data released',
      boundary: 'Scenario calibration, not production TCA; realized latency value and finality remain unmeasured.',
    },
    paperPath: '/research/replication/papers/settlement-latency-value.md',
    heroArt: {
      src: '/research/cross-chain-latency-editorial.jpg',
      alt: 'A precision stopwatch feeds an amber ribbon across a navy ledger gap into a long accordion of ivory paper leaves, representing minute-scale execution time expanding into a multi-day financing horizon.',
      caption: 'Editorial illustration: one minute unspools into the financing horizon. At 3.65% SOFR, the source-verified 10bp policy ceiling equals 9.86 days of simple ACT/360 carry; the generated figure below contains the quantitative evidence.',
    },
    indexFigure: {
      src: '/research/latency-carry.svg',
      alt: 'Log-scale chart comparing the 10bp routing-policy ceiling with simple SOFR financing carry for one to sixty minutes saved.',
      caption: 'At 3.65% SOFR, 10bp equals 9.86 days of simple ACT/360 carry. Minute-scale speed needs an economic justification beyond cash carry alone.',
    },
    keywords: [
      'cross-chain execution', 'routing latency', 'transaction cost analysis',
      'settlement finality', 'SOFR', 'execution policy', 'bridge routing',
      'treasury liquidity', 'latency economics',
    ],
    body: LATENCY_BODY,
  },
  {
    slug: 'points-programs-tullock-contests',
    title: 'Incentive budgets as market design: what survives after the model fails',
    date: '2026-07-26',
    updated: '2026-08-08',
    category: 'Model risk',
    kind: 'research',
    excerpt: 'Treat the reward pool as a budget-allocation mechanism. The active-set forecast failed; what remains is narrower but useful: a conditional view of cost capture, identity-splitting incentives, and why solver verification is not model validation.',
    readMins: 14,
    status: 'published',
    evidence: {
      status: 'MODEL — CHALLENGED',
      asOf: '2026-08-08',
      basis: 'Exact equilibrium + seeded Monte Carlo · field test released',
      boundary: 'Retained for conditional mechanism analysis; rejected for wallet-level allocation forecasting.',
    },
    paperPath: '/research/replication/papers/points-tullock-contests.md',
    indexFigure: {
      src: '/research/points-participation.svg',
      alt: 'Model output showing the active set shrinking as assumed cost dispersion increases across simulated economies.',
      caption: 'Implementation can be correct while the intended model use is wrong. This active-set output is retained as a scenario benchmark after failing wallet-level outcome analysis.',
    },
    keywords: [
      'points program design', 'airdrop farming', 'Tullock contest',
      'token distribution', 'sybil resistance', 'rent seeking',
      'incentive program design', 'crypto airdrop economics', 'model risk',
      'reward program economics',
    ],
    body: POINTS_BODY,
  },
  {
    slug: 'airdrop-concentration',
    title: 'When a mathematically correct model is wrong: an allocation-model validation case study',
    date: '2026-07-31',
    updated: '2026-08-08',
    category: 'Model validation',
    kind: 'research',
    excerpt: 'The solver passed; the forecast failed. HYPE and EIGEN reject the model’s wallet-level active-set prediction, turning this into a case study in outcomes analysis, use limitation, data lineage, and the gap between wallets and beneficial owners.',
    readMins: 13,
    evidence: {
      status: 'MEASURED',
      asOf: '2026-08-01',
      basis: '329,947 primary recipient wallets · code and data released',
      boundary: 'Wallet-level outcomes; beneficial owners and causal mechanism unresolved.',
    },
    paperPath: '/research/replication/papers/airdrop-concentration.md',
    indexFigure: {
      src: '/research/airdrop-lorenz.svg',
      alt: 'Lorenz curves comparing observed HYPE and bonus-adjusted EIGEN wallet allocations with the Tullock-model allocation shape.',
      caption: 'Outcome analysis rejects the tiny active-set shape. The measured vectors remain highly unequal, while wallet-to-beneficial-owner resolution remains a separate control problem.',
    },
    keywords: [
      'airdrop concentration', 'airdrop allocation data', 'Hyperliquid HYPE airdrop',
      'EigenLayer EIGEN airdrop', 'Tullock contest empirics', 'points program design',
      'token distribution Gini', 'airdrop farming', 'model validation', 'outcomes analysis',
    ],
    status: 'published',
    body: AIRDROP_BODY,
  },
  {
    slug: 'tempo-fee-payer-0x76',
    title: 'The fee payer as a treasury control surface: sponsored execution on Tempo',
    date: '2026-07-31',
    updated: '2026-08-08',
    category: 'Payments control',
    kind: 'engineering',
    excerpt: 'Fee sponsorship is more than “gasless” UX: it separates asset authority from network-fee liability and can turn fee funding into a central treasury function. The current implementation proves the primitive but not yet ledger-grade budget control.',
    readMins: 11,
    status: 'published',
    evidence: {
      status: 'SOURCE-VERIFIED',
      asOf: '2026-08-08',
      basis: 'Current main + Tempo primary specifications',
      boundary: 'Implementation verified; production enablement and realized fee control unverified.',
    },
    indexFigure: {
      src: '/research/tempo-fee-payer-control.svg',
      alt: 'Control map showing Tempo sender asset authority separated from sponsor network-fee authority in one transaction.',
      caption: 'The fee payer is a separate treasury authority, not “free gas.” Implementation is source-verified; production enablement and receipt-reconciled hard budgets remain unverified.',
    },
    keywords: [
      'Tempo blockchain', 'fee sponsorship', 'stablecoin network fees',
      'treasury controls', 'type 0x76', 'sponsored transactions',
      'payments operations',
    ],
    body: TEMPO_BODY,
  },
  {
    slug: 'best-price-routing',
    title: 'A router is an execution policy: price, evidence quality, and the TCA gap',
    date: '2026-07-31',
    updated: '2026-08-08',
    category: 'Execution governance',
    kind: 'engineering',
    excerpt: 'The integration count is inventory; the real product is the decision policy. Current routing changes objective with evidence quality and prices time only narrowly, while realized TCA, failure cost, finality, and route-risk calibration remain open.',
    readMins: 12,
    status: 'published',
    evidence: {
      status: 'SOURCE-VERIFIED',
      asOf: '2026-08-08',
      basis: 'Current main + primary execution/control sources',
      boundary: 'Quote-selection policy verified; realized TCA and best-execution outcome unproven.',
    },
    indexFigure: {
      src: '/research/routing-decision-waterfall.svg',
      alt: 'Decision waterfall for quote routing, from the returned comparison set through evidence-quality gates and the final cross-chain tiebreak.',
      caption: 'The integration roster is inventory; the router is the policy. Evidence quality determines whether the current engine may rank net of gas or must fall back to gross output.',
    },
    keywords: [
      'DEX routing', 'cross-chain routing', 'transaction cost analysis',
      'execution policy', 'best execution', 'quote aggregation',
      'routing governance',
    ],
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
    excerpt: 'The Python engine logs returned multi-provider quote sets and the agent/web path samples alternative LI.FI routes. A publishable benchmark still requires those decision records to be joined to realized fills, gas, failures, and finality on a common basis.',
    status: 'planned',
  },
];

export const publishedPosts = researchPosts.filter((p) => p.status === 'published');
export const plannedPosts = researchPosts.filter((p) => p.status === 'planned');
export function getPost(slug: string) {
  return researchPosts.find((p) => p.slug === slug && p.status === 'published');
}
