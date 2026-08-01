// Research / writing feed. Published posts carry full markdown `body` (rendered
// with the same pipeline as the docs). "planned" posts show as upcoming on the
// index — credible roadmap, not fabricated content.

export type ResearchPost = {
  slug: string;
  title: string;
  date: string; // ISO; empty for planned
  category: 'Protocol' | 'Architecture' | 'Security' | 'Agents' | 'Benchmarks';
  excerpt: string;
  readMins?: number;
  status: 'published' | 'planned';
  /** Topic terms emitted into the post's ScholarlyArticle structured data. */
  keywords?: string[];
  body?: string;
};

const TEMPO_BODY = `# Gasless swaps on Tempo: how fee-payer (type 0x76) transactions actually work

Onboarding a new user to crypto has a chicken-and-egg problem: to make their first swap they need gas, but to get gas they usually need to already hold the native token. Tempo's fee-payer transaction type lets us cut that knot — a sponsor pays the gas so the user doesn't have to. This post walks through how Suwappu sponsors a user's first swaps, end to end.

## The problem with "just pay gas"

On most chains, every transaction must be signed by the account that pays for it. A brand-new wallet with a zero balance literally cannot broadcast anything. The usual workarounds — faucets, meta-transactions, ERC-4337 paymasters — each add moving parts.

Tempo takes a more direct route: a dedicated transaction type where the **gas payer and the sender are two different signatures on the same transaction**.

## Type 0x76: two signers, one transaction

A Tempo fee-payer transaction (type \`0x76\`) is built so that:

- The **user** signs the call they want to make (the swap).
- A **fee payer** counter-signs, agreeing to cover the gas.

Both signatures travel in one transaction. The network verifies both, debits gas from the fee payer, and executes the user's intent. The user never needs the native token.

\`\`\`text
tx (type 0x76)
├─ user signature      → authorizes the swap
└─ fee-payer signature → authorizes paying gas
\`\`\`

## How Suwappu sponsors it

When a sponsored swap is eligible, the engine builds the 0x76 transaction and asks our fee-payer wallet to counter-sign it via the \`pytempo\` SDK:

\`\`\`python
# 1. Build the user's swap as a fee-payer (0x76) transaction
tx = build_fee_payer_tx(user_swap, fee_payer=sponsor_address)

# 2. Sponsor counter-signs the gas
signed = sponsor_wallet.cosign_fee_payer(tx)

# 3. Broadcast — user paid nothing for gas
receipt = await tempo.send(signed)
\`\`\`

Because Tempo settles in TIP-20 stablecoins and fees are sub-cent, the user's *total* cost on a sponsored swap is on the order of **$0.001**.

## Guardrails (so sponsorship is sustainable)

Sponsorship is a best-effort onboarding perk, not an unlimited faucet. It is bounded by:

- A small **per-user lifetime cap** on sponsored swaps.
- A **daily USD budget** across all users.
- A **graceful fallback**: if sponsorship is unavailable — budget exhausted, signer busy — the swap still executes, user-paid. Nothing ever blocks.

The accounting is intentionally best-effort (in-memory), so a restart resets counters. That's an acceptable trade for an onboarding perk; it is not a financial guarantee.

## Why this matters for agents

The same mechanism that smooths human onboarding matters even more for autonomous agents: an agent's first action shouldn't require pre-funding a gas account in the native asset. Fee-payer transactions let an agent transact in stablecoins from the first call.

## Takeaways

- Type \`0x76\` carries two signatures — sender and gas payer — in one transaction.
- Suwappu counter-signs gas for eligible first swaps via \`pytempo\`.
- It's bounded by per-user and daily limits, with a user-paid fallback.
- Net effect: a first swap that costs about a tenth of a cent, in stablecoins, with no native gas token required.
`;

const ROUTING_BODY = `# Best-price routing: how Suwappu picks the winning quote

"Cross-chain swap" is the easy part to say and the hard part to do well. Liquidity for any given pair is scattered across dozens of DEXes, aggregators, and bridges, each with different prices, gas, and reliability. Suwappu's job is to make that fragmentation invisible — to return the *best* quote, not the first one. Here's how the routing engine works.

## The naive approach (and why it loses)

The simplest design is to pick one aggregator and forward every request to it. It's easy, and it's usually wrong: no single source is best for every pair, chain, and size. Routing to one venue means systematically leaving value on the table for everything that venue isn't best at.

## Race the field, compare apples to apples

Instead, for each swap Suwappu fans the request out to multiple providers in parallel and compares the results:

\`\`\`text
quote request
   ├─▶ LiFi
   ├─▶ CoW Protocol
   ├─▶ OKX
   ├─▶ 1inch
   ├─▶ KyberSwap
   ├─▶ Jupiter      (Solana)
   ├─▶ Across       (fast bridging)
   └─▶ CCTP         (native USDC)
         │
         ▼
   normalize → rank → best quote
\`\`\`

The trick is in *normalize → rank*. A raw output amount is meaningless until you subtract everything that eats into it. We rank on **net output** — expected tokens out, minus gas, minus bridge/relayer fees, minus price impact — so a route that quotes a bigger number but costs more in gas doesn't win on a technicality.

## Same-chain vs cross-chain

The engine treats two cases:

- **Same-chain swaps** route through DEX aggregators (e.g. LiFi on EVM, Jupiter on Solana).
- **Cross-chain swaps** add a bridge leg — Across for speed, CCTP for native USDC — and the ranking accounts for bridge time and cost, not just the swap.

A single user intent ("swap X on chain A for Y on chain B") can therefore resolve to a multi-step route, quoted and priced as one number.

## MEV-aware execution

The best *quote* is wasted if the *fill* gets sandwiched. Where it helps, swaps can route through MEV-shielded venues (e.g. CoW) so the price you were quoted is closer to the price you get. Token-security heuristics and transaction simulation run before funds move.

## Why "best of N" is the whole product

Racing the field costs a little latency and a lot of integration work — every provider has its own API, quirks, and failure modes. But it's the difference between "we support N chains" and "we get you the best execution across N chains." For agents especially, that consistency matters: an autonomous caller can't eyeball a bad route, so the engine has to be the one that never takes one.

## Takeaways

- Suwappu races up to nine providers per swap and ranks on **net output**, not headline amount.
- Same-chain and cross-chain intents resolve through one ranked pipeline.
- MEV-shielding and pre-trade checks protect the fill, not just the quote.
- "Best of N" is the point — especially for agents that can't catch a bad route themselves.
`;


const USDT0_BODY = `# What actually backs an omnichain dollar: measuring USDT0 across 17 chains

We published a number, then found out it was wrong. This post is the corrected version, and the correction is more useful than the original finding.

Omnichain stablecoins move dollar liabilities across chains through lock-and-mint mechanics rather than per-chain custodians. Canonical USDT is escrowed in a lockbox contract on Ethereum; remote chains carry mint-and-burn representations. That design relocates a solvency question into a place anyone can check. For the underlying token, backing is an off-chain reserve attested periodically by an auditor. For the omnichain representation, backing is an on-chain escrow balance, and the invariant is continuously verifiable from public state:

> Collateral held in the lockbox must be at least the sum of minted supply across every remote chain.

This is narrower than asking whether USDT is fully backed. We are not auditing anyone's reserves. We are asking whether the omnichain representation is solvent as a bridge, at the one layer of the stack that can be checked cheaply, continuously, and without permission.

## What we measured

We read chain state directly, every 48 hours for twelve months, across 17 EVM deployments. No block explorer API, no subgraph, no third-party indexer. Every liability figure is a totalSupply call against a verified token contract; every collateral figure is a balanceOf call against canonical USDT on Ethereum for the lockbox address.

One methodological point matters more than it sounds. Seventeen chains have seventeen block times, so querying each chain at its current head and summing the results does not produce a snapshot — it sums states that can be minutes apart, which is exactly when a large flow is moving. Instead we fix a target timestamp and, per chain, locate the highest block whose timestamp is at or before it, then read state at that block. Every term in the sum is then evaluated at the same moment in wall-clock time.

## Provenance: why some of these tokens were never lock-and-mint

One objection has to be dealt with before any sum means anything. On several chains the contract now serving as USDT0 is not a fresh deployment. It is that chain's pre-existing canonical USDT contract, upgraded in place to speak mint/burn semantics. Arbitrum and Polygon are the two material cases, and together they are 51.9% of measured supply. Supply minted on those tokens *before* migration was not collateralized by the lockbox, which did not yet hold the corresponding assets.

The natural hypothesis is that it sat in each chain's own canonical bridge escrow on Ethereum. We tested that directly, reading those escrows at the same block heights as everything else, and it fails. Across the entire pre-migration window the Polygon ERC20 predicate held $0.00 of USDT and the Arbitrum L1 gateway held between $140k and $346k, against a measured shortfall of $1.17bn to $1.33bn.

Optimism is the instructive exception. Its L1StandardBridge holds $214.9m of USDT — but that backs Optimism's *separate* legacy USDT contract, a different address from the USDT0 contract we measure on Optimism. Same chain, same asset name, different contract, different backing account. That is what a false positive looks like, and it is why a candidate backing account has to be verified rather than assumed.

## The correction

The first version of this study measured 12 chains. The issuer documents roughly 22 networks. An adversarial reviewer, working from the issuer's own deployments page, read the legs we had skipped and found supply we had never counted. We verified every one independently by direct contract call: Monad $72.31m, Stable $29.57m, Conflux $16.45m, Tempo $9.19m, Morph $4.70m, Sei $2.50m, Hedera $84k. Together, $134.8m of liabilities missing from our own denominator.

**Table 1. Like-for-like snapshot at current head, 2026-07-26, all reads in one session.**

| | Original 12-chain universe | Corrected EVM universe |
|---|---|---|
| Lockbox collateral | $3,392.9m | $3,392.9m |
| Measured liabilities | $3,255.4m | $3,390.2m |
| Collateralization ratio | 1.042 | 1.001 |
| Buffer | $137.5m | $2.7m |
| Buffer, share of liabilities | 4.2% | 8 basis points |

Completing the universe eliminates 98.0% of the reported surplus. That is a head read, not a block-aligned one. Run inside the re-collected panel instead, at the last aligned observation on 2026-07-25, the same comparison gives 1.042 and $137.1m on the old universe against **1.002 and $5.1m** on the new one — eliminating 96.3%. The difference between the two figures is Sei and Hedera, which the panel does not carry. Both are quoted below where each belongs; they are not interchangeable.

The error is ours and it has a clean description. The first version stated the rule that a candidate backing account must be verified rather than assumed. We applied that discipline to the collateral side and not to the liability side, where the symmetric obligation is to enumerate deployments from the issuer's registry rather than from the set we already had a collector for. Version one named $136.5m of unmeasured supply as the figure that would overturn its conclusion. Public chain state supplied $134.8m of it, within days, at a cost of one contract call per chain.

![Collateralization ratio over twelve months in the upper panel, and the number of chains returning live supply in the lower panel, rising in steps from 8 to 17.](/research/usdt0-ratio-coverage.svg "The apparent surplus shrinks as the measured universe grows. The lower panel is the confound: coverage rises from 8 chains to 17 across the sample, so early readings undercount liabilities and the series is not comparable across time.")

## Two regimes, and what the first one is not

The panel splits cleanly at late August 2025.

Before it, 16 observations run 0.513 to 0.588 — median 0.562, every one below 1.0, median shortfall $1.19bn. Read naively that says USDT0 was half-backed for a month. **It cannot be read that way.** The escrow controls above rule out the reading that would have made it benign in the obvious way, but two readings still survive: pre-migration supply on Arbitrum and Polygon was issued against off-chain reserves, in which case the on-chain invariant did not apply to it and the pre-break ratio measures nothing at all; or the backing sat in an account we did not identify. The balances we can read do not separate them. The defensible statement is that the pre-migration lockbox did not back measured supply and the account that did is unidentified in our panel.

After it, across 165 observations, the ratio is **never below 1.0** — minimum 1.002, median 1.032.

![Lockbox collateral against total measured liabilities over twelve months, running well below until late August 2025, converging in a single step, then tracking just above through the expansion and contraction.](/research/usdt0-collateral.svg "Collateral runs well below liabilities until late August 2025, converges in one step, then tracks close above them through a supply cycle that peaks near $7.7bn.")

## The consolidation, dated two ways

The discontinuity is worth reporting precisely because it can be dated independently twice. A six-hourly rescan places an increase of $1,258,602,286 in the lockbox between 27 August 2025 12:00 and 18:00 UTC — Ethereum blocks 23,232,316 to 23,234,104 — while Arbitrum supply *fell* $98.1m and Polygon moved by $243k. Collateral arrived; liabilities did not. The move is confined to that bracket; over the following 18 hours the balance drifts by $12m, ordinary flow rather than a second step.

Separately, an exhaustive least-squares changepoint search over the 48-hour panel, given no input from that rescan, locates the break in the same window.

Two caveats on that second method, because it is weaker than it looks. A step this large is visible to the naked eye, so a changepoint search was never going to miss it — the rescan is the evidence and the test is corroboration. And under the no-break null the bootstrap distribution is wildly heavy-tailed, with a 95th percentile of 337 against a maximum of 14,287, which is a useful measure of how much spurious break evidence serial persistence alone can manufacture.

What we cannot tell you is why. Arbitrum supply moving *down* rules out "new liabilities were issued and later over-collateralized." The data are consistent with an existing pool of USDT being deposited into the lockbox. The balance change is an observation; "consolidation" is our inference, and an issuer statement at the time would have settled it.

## The buffer, and what it says about policy

Post-break the buffer ran from $5.1m to $760.3m, median $113.7m — 15 basis points to 18.7% of measured liabilities, median 3.2%.

The dollar minimum and the share minimum are the same observation: the last one, 2026-07-25, at the sample's highest coverage of 17 chains. **The buffer is thinnest where the measurement is most complete**, which is the single most important sentence in this section. The second-thinnest share, 45 basis points on 2025-10-18, falls on the largest measured liability base at $7.69bn — but with only 10 of 17 chains covered, so it is as much a statement about coverage as about backing.

![Surplus collateral after the August 2025 consolidation, shown in dollars in the upper panel and as a share of liabilities in the lower panel.](/research/usdt0-buffer.svg "The buffer post-consolidation, in dollars and as a share of liabilities. The thinnest reading is the last one, at the sample's most complete coverage.")

Read across the whole post-break series, 165 observations above par with strong persistence is evidence of a **maintained collateral policy** rather than of 165 independent tests. That is the honest characterisation, and it cuts both ways: it means the system is being actively managed, and it means the exceedance count is much weaker evidence than the raw tally suggests.

## Why the negative result is the useful one

Tron, TON and MegaETH remain unmeasurable with this method — the first two are not EVM chains and cannot be read with a contract call at all. Measured liabilities are therefore a lower bound, and **every ratio here is an upper bound**.

That matters because of how thin the margin is. Unmeasured supply above $5.1m flips the latest observation below 1.0. Above $113.7m it flips half the post-break sample. At $50m, 26.1% of post-break observations flip; at $100m, 41.8%; at $200m, 89.1%. Against the $134.8m we have already been wrong by once, these are not exotic magnitudes.

So the residual buffer is smaller than the error bar around it, and the defensible conclusion is not a number but a limit.

**Full backing of USDT0 cannot be verified from public EVM state alone.**

For anyone holding or routing the asset, the on-chain check does not substitute for issuer disclosure at this margin. For a supervisor, it identifies precisely which disclosure would close the gap: a canonical, machine-readable deployment registry with per-leg supply. Neither conclusion was available from the version of this work that reported a comfortable surplus.

## The symmetric rule

The generalisable lesson is one sentence. **Both sides of the invariant must be enumerated from an external registry and verified account by account, not inherited from whatever the collector was already configured to read.**

On the collateral side that means the backing account is verified rather than assumed — Optimism's $214.9m backing a differently-addressed token is what happens when it isn't. On the liability side it means the deployment set comes from the issuer's published list, with every entry either measured or named and sized as unmeasured. A monitor that does the first and not the second reports a comfortable surplus that is an artifact of its own configuration file. Ours did, for one version.

## Statistical notes

The panel is 183 observations at 48-hour intervals; the 165 quoted throughout are the post-break subsample, which is the only regime where the invariant is well defined. Four things a careful reader should know:

- **The series is strongly serially correlated.** Post-break AR(1) persistence is 0.616, with Ljung–Box rejecting white noise at every lag tested. Effective sample size is 39.2 of 165. Newey–West standard errors are 1.70× the naive figure, giving a 95% HAC interval on the post-break mean of [1.025, 1.038].
- **The level is not comparable across time.** Chain coverage rises from 8 to 17 across the sample. Early readings undercount liabilities and are biased upward, which is why we lead with the current, best-covered reading rather than a historical average — and why the post-break median of 1.032 is not a finding about backing.
- **Several newly added chains have no public archive access.** Monad returns supply on 3 of 183 observations, Stable on 1. They can be read today but not backfilled. That is a hard limit on the history, not an oversight.
- **Zero-filling biases the ratio up.** Cells labelled not-deployed are not verified by a bytecode check, so archive-depth failure and genuine non-deployment are not distinguished. Both are zero-filled, and both push liabilities down and the ratio up. This is the principal remaining defect in the collection harness.

## What would change our view

- **Any measurement of Tron, TON or MegaETH supply.** These are the largest known holes, and at a $5.1m buffer they are the binding condition.
- **Backfilled archive access to Monad, Stable, Tempo, Morph and Conflux.** Without it, no time-series claim here survives beyond the observations where coverage is constant.
- **Identification of the pre-migration backing account**, which would make that regime measurable either way.
- **Evidence the escrowed USDT is encumbered.** We measure the lockbox's balance, not its legal status. If the escrowed USDT is pledged or rehypothecated, the balance we read overstates available backing. At 15 basis points, any encumbrance at all is decisive.
- **A nonzero fee parameter on canonical USDT.** The transfer paths assume a lossless transfer with no pre/post balance check, a gap flagged in third-party audit review. Tether's fee parameter is currently 0. Were it set nonzero, credited amounts could diverge from amounts received, breaking the invariant by design rather than by operational event. Dormant today, and the one structural path we know of by which the ratio could be violated silently.
- **In-flight cross-chain messages.** A transfer debited at source but not yet credited at destination understates liabilities while the message is in flight. We did not detect or exclude these. At a $5.1m buffer this is no longer a tail refinement.
- **An issuer statement contradicting the consolidation reading.**

## If you build on Suwappu

We run [cross-chain execution infrastructure](/solutions) across several of the chains measured here, and this reconciliation began as an internal check on our own balance accounting. Two things follow for anyone building on top of us.

First, the method transfers. If you are routing value through any omnichain asset, the universe of deployments is part of your risk model, and enumerating it from the issuer's registry — not from your existing integrations — is the step that is easy to skip and expensive to get wrong.

Second, this is the kind of check that belongs in software rather than a PDF. A solvency reading that gates routing, or an [agent-facing](/agents) risk call that an autonomous system can query before it moves size, is worth more than an annual report. That is where this work is going next.

## Data and code

Every figure comes from a documented contract address at a stated block height, using public RPC endpoints and no credentials.

**[The full working paper, the collection harness, the analysis, the statistical tests and every dataset are published here](/research/replication)** — including [the superseded 12-chain panel](/research/replication/data/usdt0_panel_v1_12chain.csv), so the correction above can be checked directly rather than taken on trust.

This post is an abridgement. [The paper](/research/replication/papers/usdt0-collateral-reconciliation.md) carries the full method, the per-chain composition table, the complete robustness section and the disclosures — and where the two disagree, the paper governs.

---

*Disclosures: this is research, not investment advice, and nothing here is a recommendation to buy, sell or hold any asset. Suwappu builds cross-chain execution infrastructure spanning several of the chains measured and holds operational stablecoin balances incidental to running it. We did not contact Tether, Everdawn Labs or any other issuer named; no issuer reviewed or confirmed any finding. Where we infer intent from balances, we say so. All data is read from public chain state.*`;

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

export const researchPosts: ResearchPost[] = [
  {
    slug: 'omnichain-dollar-collateral',
    title: 'What actually backs an omnichain dollar: measuring USDT0 across 17 chains',
    date: '2026-07-26',
    category: 'Security',
    excerpt: 'We read USDT0 collateral and cross-chain supply from chain state for twelve months. Completing the deployment universe removed 98% of the surplus we first reported, leaving a buffer of 15 basis points.',
    readMins: 13,
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
    slug: 'tempo-fee-payer-0x76',
    title: 'Gasless swaps on Tempo: how fee-payer (type 0x76) transactions work',
    date: '2026-06-12',
    category: 'Protocol',
    excerpt: 'A walkthrough of Tempo’s two-signature fee-payer transaction type and how Suwappu sponsors a user’s first swaps for about a tenth of a cent.',
    readMins: 5,
    status: 'published',
    body: TEMPO_BODY,
  },
  {
    slug: 'best-price-routing',
    title: 'Best-price routing: how Suwappu picks the winning quote',
    date: '2026-05-28',
    category: 'Architecture',
    excerpt: 'Why we race up to nine aggregators per swap and rank on net output — not the headline amount — across same-chain and cross-chain routes.',
    readMins: 6,
    status: 'published',
    body: ROUTING_BODY,
  },
  {
    slug: 'hyperliquid-egress',
    title: 'Building HyperLiquid into a bot: HyperUnit, region gating, and egress',
    date: '',
    category: 'Architecture',
    excerpt: 'An engineering story on integrating an on-chain order-book DEX and routing native deposits through HyperUnit without tripping region restrictions.',
    status: 'planned',
  },
  {
    slug: 'kms-key-management',
    title: 'Managing hot-wallet keys: KMS envelope encryption and migrating off Fernet',
    date: '',
    category: 'Security',
    excerpt: 'How managed-wallet keys are encrypted at rest with kms_aesgcm_v2, and what it took to migrate legacy records without downtime.',
    status: 'planned',
  },
  {
    slug: 'mcp-for-swaps',
    title: 'An MCP server for cross-chain swaps: a safe DeFi tool for agents',
    date: '',
    category: 'Agents',
    excerpt: 'The design of an agent-facing swap surface — tool shape, quote/settlement contract, and the policy guardrails that keep autonomous execution in bounds.',
    status: 'planned',
  },
  {
    slug: 'route-benchmarks',
    title: 'Benchmarking cross-chain routes: latency and price impact',
    date: '',
    category: 'Benchmarks',
    excerpt: 'A reproducible methodology for measuring quote latency and realized price impact across our supported aggregators and bridges.',
    status: 'planned',
  },
];

export const publishedPosts = researchPosts.filter((p) => p.status === 'published');
export const plannedPosts = researchPosts.filter((p) => p.status === 'planned');
export function getPost(slug: string) {
  return researchPosts.find((p) => p.slug === slug && p.status === 'published');
}
