// Research / writing feed. Published posts carry full markdown `body` (rendered
// with the same pipeline as the docs). "planned" posts show as upcoming on the
// index — credible roadmap, not fabricated content.

import stats from '@/data/stats.generated.json';

export type ResearchPost = {
  slug: string;
  title: string;
  date: string; // ISO; empty for planned
  category: 'Protocol' | 'Architecture' | 'Security' | 'Agents' | 'Benchmarks';
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


const USDT0_BODY = `# The under-collateralization was our artifact: USDT0, measured completely, twice corrected

We have now published this measurement three times, and each version corrected the one before it. The first reported a comfortable surplus; completing the liability universe destroyed 96% of it. The second reported a month in which the system looked 51-59% collateralized, with the backing account "unidentified." This version identifies that account — we had verified the wrong address — and the corrected series never falls below par. The errors are documented in full because they are the most instructive part of the work.

The invariant under test is the one thing an omnichain dollar makes checkable from public state: the USDT escrowed in the Ethereum lockbox must cover the USDT0 minted across every remote chain. We read it directly — totalSupply() and balanceOf() by archive call at block-height-aligned timestamps, every 48 hours for twelve months, no explorer APIs, no indexers.

## Correction 2: the account, identified

Version 2 reported 16 observations at ratios of 0.513-0.588 and tested the obvious hypothesis — that pre-migration Polygon supply was backed at Polygon's canonical bridge escrow. The test came back empty: the address we had recorded as the Polygon ERC20 predicate held $0.02 throughout. We published the shortfall as real-but-unexplained, backing account unknown.

The address was wrong. The canonical Polygon PoS predicate — one lookup away in Polygon's own bridge documentation — is \`0x40ec5B33f54e0E8A33A975908C5BA1c14e5BbbDf\`, and archive reads at the panel's own blocks show it held **$1.22-1.39bn across the entire pre-break window**, covering Polygon-leg supply at 1.006-1.015 at all 16 observations. An empty balance at a wrong address is indistinguishable from an empty escrow. Nothing in the $0.02 reading could have told us which we had.

![Two series: version 2's published collateralization ratio, dashed, falling to 0.51-0.59 before late August 2025, and the corrected series including the canonical Polygon predicate, solid, holding near 1.02 continuously across the full year.](/research/usdt0-corrected-series.svg "The published under-collateralization was a wrong-address artifact. Corrected, the system holds ~1.02 across the entire sample — zero of 183 observations below par.")

With the right account restored, the corrected aggregate ratio pre-break is **1.017-1.028, median 1.021**. The two "regimes" of version 2 collapse into one continuously-collateralized system whose backing was split across two accounts and then consolidated. The decomposition closes flow by flow, not just in levels: regressing each backing account on *its own leg's* liability flow gives β = 1.018 (SE 0.010) for the lockbox against non-Polygon flow and β = 1.085 (SE 0.032) for the predicate against Polygon flow, correlations 0.99 — each account matched its leg's marginal flow throughout, at the same ~3% level margin all year (pre-break lockbox-leg median 1.032; post-break median 1.032).

## The consolidation was never a mystery — the issuer announced it, same day

Version 2 bracketed a $1,258,602,286 lockbox inflow to a six-hour window on 27 August 2025 and called the cause "our inference." The complete accounting at the bracket blocks: the predicate fell **$1,358,841,579 — matching Polygon supply at the bracket open to within $82k** — the lockbox rose $1,258.6m, Arbitrum supply fell $98.1m, residual $2.1m of ordinary flow. And the issuer had published it as it happened: *"The supply backing PoS USDT on Polygon has now been migrated to the USDT0 lockbox on Ethereum mainnet"* — USDT0 blog, 27 August 2025. Version 2 wrote "an issuer statement would change our view" while that statement had been up for eleven months. We ran a changepoint search with a bootstrapped sup-F statistic to date an event whose date was in a press release.

## The first complete-universe reading: three basis points

Version 2's biggest named holes — Tron, TON, MegaETH — resolved in ways we did not expect. **Tron and TON hold no USDT0 at all**: the issuer's registry lists them under the separate Legacy Mesh, where native Tether USDT converts against liquidity pools through an Arbitrum hub. They were never lockbox liabilities; classifying them as "unmeasured USDT0" was our category error. MegaETH, meanwhile, now exposes a public RPC — we verified the contract and read it directly ($2.2m). HyperCore is a sub-ledger whose $12.3m float we verified is already contained inside the HyperEVM supply the panel counts.

Which means that for the first time, every deployment the issuer documents is measurable, and we measured all of them in one session on 1 August 2026:

| | |
|---|---|
| Liabilities, all 20 readable legs | $3,452.6m |
| Lockbox collateral | $3,453.6m |
| Ratio | **1.0003** |
| Buffer | **$1.03m — three basis points** |

The reads span about a minute of wall clock rather than one aligned block height — which typically moves the sum by tens of thousands of dollars, not millions; the reason we still refuse to sign the buffer is that in-flight cross-chain messages, any encumbrance of the escrowed USDT, and any registry omission each plausibly exceed $1m, and none is visible to a balance read. So the honest statement of the headline result: **measured completely, USDT0's backing is indistinguishable from exactly 1:1, with no measurable cushion.** Anything the balance check cannot see — encumbrance of the escrowed USDT, messages in flight between chains, a registry omission — is now larger than the margin. The check has become possible at precisely the scale where the check alone stops being sufficient.

## The buffer is operated to no visible rule — and it was wound down to par

Post-consolidation, the dollar buffer ran $5.1m to $760.3m — 15 basis points to 18.7% of liabilities, a 124× range in share terms, which no proportional target survives. Nor is it inert: **eleven** discrete 48-hour movements exceed $100m and do not correspond to liability flow — +$508m in and −$597m out against essentially flat supply in December alone. Someone operates this account at nine-figure discretion, to no size rule the data can identify (pure discretion, a dollar floor, and pre-funding for expected mints are all consistent with what we see).

![Two panels: the collateral buffer in dollars, spiking to $760m in December 2025 then declining through 2026 to $5m at the end of the sample, and the buffer as a share of liabilities, ranging from 18.7% down to 15 basis points.](/research/usdt0-buffer.svg "The buffer in dollars and as a share of liabilities. The 124x range in share terms rules out a proportional target; the 2026 decline ends at measurement noise.")

The fact that matters most for anyone holding the asset: **the cushion was run down to par by sample end.** The buffer fell from $296.9m at end-December to $78.9m in late June, then collapsed to $5.1m at the final panel observation — collateral withdrawn $117m beyond liability decline in the last eight days alone — and the complete-universe head reading finds it at $1.03m. Zero observations below par in the corrected sample is a true statement about the past (worth ~39 independent looks once persistence is accounted for). The endpoint — a margin at measurement noise — is the statement about now. And one more honesty note: the panel's final $5.1m is a 17-leg number, and the three legs the panel never carried held $4.9m at the head reading, so the complete-universe buffer at the last observation was likely on the order of $0.2m, sign undeterminable. Universe truncation manufactures surplus even at the sample's last row — our own rule, applying to our own tail.

## The rule, learned twice

Both corrections are the same error, mirrored. Version 1 summed the liabilities it had configured (12 of 22 legs) and reported an artifactual surplus. Version 2 read the collateral control it had configured (the wrong predicate) and reported an artifactual shortfall. **Both sides of the invariant must be enumerated from the issuer's registry and verified account by account — with the account-to-leg mapping treated as the thing under test, not an input.** A monitor that inherits either side from its own configuration file will eventually publish one of these errors with confidence, as we did, twice.

For issuers, the constructive version: publish a machine-readable registry of legs, contracts, and the backing account per leg per period. Every error in this paper's history traces to reconstructing that mapping by hand.

## What would change our view

Evidence the escrowed USDT is encumbered — at three basis points, any encumbrance is decisive. A nonzero fee parameter on canonical USDT, the one structural path by which credited and received amounts could diverge silently. In-flight message volume, which understates liabilities and now routinely exceeds the buffer. Archive access to Monad and Stable, whose history cannot be backfilled — Monad grew 30% in the five days between our panel close and the head reading, so the truncated history is increasingly the story. And a dated correction from the issuer to any figure here; given this paper's history, we would treat that as the expected case.

## If you build on Suwappu

We run [cross-chain execution infrastructure](/solutions) across several of the chains measured here, and this reconciliation began as an internal check on our own balance accounting. The method transfers: if you route value through any omnichain asset, the deployment universe and the backing-account mapping are part of your risk model, and both must come from the issuer's registry, not your integration list. The complete-universe check now costs about twenty RPC calls; it belongs in software, gating routing — an [agent-queryable](/agents) solvency reading rather than an annual PDF. That is where this work goes next.

## Data and code

**[The full working paper, the collection harness, every analysis script and every dataset are published here](/research/replication)** — including the superseded 12-chain panel, the wrong-address escrow series, and the archive backfill of the canonical predicate, so both corrections are independently checkable. This post is an abridgement; [the paper](/research/replication/papers/usdt0-collateral-reconciliation.md) governs.

---

*Disclosures: this is research, not investment advice, and nothing here is a recommendation to buy, sell or hold any asset. Suwappu builds cross-chain execution infrastructure spanning several of the chains measured and holds operational stablecoin balances, including USDT and USDT0, incidental to running it. We did not contact Tether, Everdawn Labs or any issuer named; no issuer reviewed any version of this work. The first correction originated in an external adversarial review we commissioned; the second in our own registry re-verification. All data is public chain state or cited public documents.*`;

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

**[Both complete recipient vectors, the collectors, the analysis, and the formal test are published here](/research/replication)** — 309,000 rows of allocation data, the model solver reused verbatim from the theory paper, fixed seeds throughout. This post is an abridgement; [the paper](/research/replication/papers/airdrop-concentration.md) carries the full method, the matched-n bands, the sup-over-σ test and the ENA post-mortem, and where the two disagree, the paper governs.

---

*Disclosures: this is research, not investment advice. Suwappu operates a fee-denominated points program of the class analyzed here; note that this paper weakens the more dramatic claim of our own prior work, and judge the incentive accordingly. We hold no position in HYPE, EIGEN or ENA. No issuer named reviewed this work. All data is public chain state or public APIs, collected 31 July 2026.*`;

export const researchPosts: ResearchPost[] = [
  {
    slug: 'omnichain-dollar-collateral',
    title: 'The under-collateralization was our artifact: USDT0, measured completely, twice corrected',
    date: '2026-07-31',
    category: 'Security',
    kind: 'research',
    excerpt: 'Our second correction: the "unidentified" $1.3bn backing account was the canonical Polygon predicate — we had verified the wrong address. Corrected, USDT0 never falls below par, and the first complete-universe reading shows a buffer of three basis points.',
    readMins: 12,
    status: 'published',
    keywords: [
      'omnichain stablecoin', 'USDT0', 'stablecoin collateralization',
      'cross-chain bridge solvency', 'proof of reserves', 'LayerZero OFT',
      'lock and mint bridge', 'on-chain reserve verification',
    ],
    body: USDT0_BODY,
  },
  {
    slug: 'points-programs-tullock-contests',
    title: 'Points programs are Tullock contests: who actually collects an airdrop',
    date: '2026-07-26',
    category: 'Architecture',
    kind: 'research',
    excerpt: 'A pro-rata points pool is captured by five to eighteen operators out of five thousand. Caps do not help; only fee denomination changes where the value lands — and the standard anti-sybil bonus is what creates the sybil incentive.',
    readMins: 10,
    status: 'published',
    keywords: [
      'points program design', 'airdrop farming', 'Tullock contest',
      'token distribution', 'sybil resistance', 'rent seeking',
      'incentive program design', 'crypto airdrop economics',
    ],
    body: POINTS_BODY,
  },
  {
    slug: 'airdrop-concentration',
    title: 'We tested our own airdrop model against 330,000 real allocations. It failed.',
    date: '2026-07-31',
    category: 'Benchmarks',
    kind: 'research',
    excerpt: 'Complete recipient vectors for HYPE genesis and EIGEN S1 reject the Tullock active-set prediction: top-1 holds 0.7-2.4% against a predicted 15-41%. Allocations are unequal like wealth, Gini ≈0.95, not like a contest — and the referee pass that corrected our own collection is part of the release.',
    readMins: 9,
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
