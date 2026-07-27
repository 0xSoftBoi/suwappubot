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

## The correction

The first version of this study measured 12 chains. The issuer documents roughly 22 networks. A reviewer read the deployments we had skipped and found supply we had never counted. We verified every one independently: Monad $72.31m, Stable $29.57m, Conflux $16.45m, Tempo $9.19m, Morph $4.70m, Sei $2.50m, Hedera $84k. Together, $134.8m of liabilities missing from our own denominator.

Same day, same method, same collateral reading:

| | Original 12-chain universe | Corrected universe |
|---|---|---|
| Lockbox collateral | $3.39bn | $3.39bn |
| Measured liabilities | $3.26bn | $3.39bn |
| Collateralization ratio | 1.042 | 1.001 |
| Buffer | $137.5m | $2.7m |

Completing the universe removed 98% of the surplus we had reported. Within the re-collected panel, at the last aligned observation, the ratio is 1.0015 and the buffer is $5.1m — fifteen basis points.

The error has a clean description, and it is ours. The first version stated the rule that a candidate backing account must be verified rather than assumed. We applied that discipline to the collateral side of the equation and not to the liability side, where the symmetric obligation is to enumerate deployments from the issuer's own registry rather than from the set we already happened to have a collector for. Version one named $136.5m of unmeasured supply as the amount that would overturn its conclusion. Public chain state supplied $134.8m of it, within days, at a cost of one contract call per chain.

![Collateralization ratio over twelve months in the upper panel, and the number of chains returning live supply in the lower panel, rising in steps from 8 to 17.](/research/usdt0-ratio-coverage.svg "The apparent surplus shrinks as the measured universe grows. The lower panel is the confound: coverage rises from 8 chains to 17 across the sample, so early readings undercount liabilities and the series is not comparable across time.")

## Why the negative result is the useful one

Tron, TON and MegaETH remain unmeasurable with the method above — the first two are not EVM chains and cannot be read with an eth_call at all. So 1.0015 is an upper bound, not a point estimate.

That leaves the residual buffer smaller than the error around it: a $5.1m surplus, on a system whose completeness we have already been wrong about once by $134.8m. The defensible conclusion is therefore not a number but a limit.

**Full backing of USDT0 cannot be verified from public EVM state alone.**

For anyone holding or routing the asset, that says the on-chain check does not substitute for issuer disclosure at this margin. For a supervisor, it identifies precisely which disclosure would close the gap: a canonical, machine-readable deployment registry with per-leg supply. Neither conclusion was available from the version of this work that reported a comfortable surplus.

## The buffer does not behave like a policy

Separating the buffer into dollars and proportion shows something a single ratio hides. The margin was proportionally thinnest exactly when the system was largest, during the period when incentive-driven supply pushed liabilities toward $7.6bn. A maintained policy ratio behaves the opposite way; an absolute residual diluted by growth behaves like this.

![Surplus collateral after the August 2025 consolidation, shown in dollars in the upper panel and as a share of liabilities in the lower panel.](/research/usdt0-buffer.svg "The buffer does not scale with the system. It was proportionally thinnest at the system's largest — the opposite of how a maintained ratio behaves.")

## A billion dollars in six hours

The panel contains one discontinuity, and it is worth reporting precisely because we can date it two independent ways. A six-hourly rescan of balances places an increase of $1,258,602,286 in the lockbox between 27 August 2025 12:00 and 18:00 UTC, while remote supply on the largest chain *fell*. Collateral arrived; liabilities did not.

Separately, an exhaustive least-squares changepoint search over the 48-hour panel — given no input from that rescan — locates the break in the same window, with a bootstrap p-value of 0.0045. Two methods, one date.

What we cannot tell you is why. The readings before that event sit near 0.55, and the tidy explanation is that the missing backing sat in each chain's canonical bridge escrow. We measured those escrows at the same block heights and the explanation fails: one held exactly zero throughout, another under $350k, against a shortfall above a billion dollars. Either that supply was issued against off-chain reserves, in which case the on-chain invariant never applied to it, or the backing sat somewhere our panel does not see. The balances we can read do not separate the two, so we report the account as unidentified rather than guess.

## Statistical notes

Three things a careful reader should know about the series:

- It is strongly serially correlated. The effective sample size is roughly 39 independent observations, not the 165 the count suggests. Standard errors adjusted for that persistence are about 1.7 times the naive figure.
- Chain coverage rises from 8 to 17 across the sample, so the level of the ratio is not comparable across time. Early readings undercount liabilities and are biased upward. This is why we lead with the current, best-covered reading rather than a historical average.
- Several newly added chains have no public archive access, so they can be read today but not backfilled. That is a hard limit on the history, not an oversight.

## What would change our view

A reachable archive endpoint for Monad or Stable, which would let the panel be backfilled rather than truncated. A non-EVM read path for Tron and TON, whose supply is currently unbounded in our measurement. Or an issuer statement confirming what the August 2025 deposit was — we report it as a balance movement, not a motive.

## If you build on Suwappu

We run [cross-chain execution infrastructure](/solutions) across several of the chains measured here, and this reconciliation began as an internal check on our own balance accounting. Two things follow for anyone building on top of us.

First, the method transfers. If you are routing value through any omnichain asset, the universe of deployments is part of your risk model, and enumerating it from the issuer's registry — not from your existing integrations — is the step that is easy to skip and expensive to get wrong.

Second, this is the kind of check that belongs in software rather than a PDF. A solvency reading that gates routing, or an [agent-facing](/agents) risk call that an autonomous system can query before it moves size, is worth more than an annual report. That is where this work is going next.

## Reproducing this

Every figure comes from a documented contract address at a stated block height, using public RPC endpoints. The collector, the analysis, the statistical tests and the full working paper are released together, including the superseded 12-chain panel so the correction itself is auditable. If you re-run it against live chains you will get a longer series with the same history.

---

*Disclosures: this is research, not investment advice, and nothing here is a recommendation to buy, sell or hold any asset. Suwappu builds cross-chain execution infrastructure spanning several of the chains measured and holds operational stablecoin balances incidental to running it. We did not contact Tether, Everdawn Labs or any other issuer named; no issuer reviewed or confirmed any finding. Where we infer intent from balances, we say so. All data is read from public chain state.*`;

const POINTS_BODY = `# Points programs are Tullock contests: who actually collects an airdrop

The pitch for a points program is that it converts usage into ownership. Thousands of users earn, the pool splits proportionally, and the token base ends up wide.

The mechanism as written down does not produce that outcome. A pro-rata split of a fixed pool by share of accumulated points is, exactly and not by analogy, a Tullock proportional contest — a class of game economists characterized in 1980. Under realistic conditions its equilibrium concentrates hard. A handful of operators with the lowest cost per point crowd everyone else to zero, without cheating, without any fixed cost of entry, and without a single sybil wallet.

Concentration is the equilibrium, not the failure mode.

## The setup

Let a fixed prize be split in proportion to points earned, and let points cost something real to acquire — gas, capital lockup, slippage, or protocol fees. Then each participant faces the payoff of a lottery contest: their share of the prize is their share of total effort, minus what that effort cost them.

Two intuitions fail immediately as a result.

The first is that caps limit extraction, so caps limit waste. They do not. The fraction of the pool competed away depends on the number and cost-heterogeneity of competitors and not at all on the unit price of a point. Sweeping that price over a thousandfold range moves the dissipated fraction by an amount indistinguishable from zero. Caps change how many points get minted. They do not change what share of the pool is burned winning them.

The second is that a points program with common costs spreads an airdrop across a user base. It does once costs are identical — and identical costs are the one case that never happens.

## What happens with realistic cost differences

Solving the equilibrium exactly, for 5,000 potential entrants with no fixed cost of entry and lognormally distributed costs, gives the following. These are medians of 500 independent draws, with the 5th-to-95th percentile band, rather than single runs:

| Cost dispersion | Active operators | Pool as operator profit | Largest operator's share |
|---|---|---|---|
| Low | 18 of 5,000 | 9.5% | 17.1% |
| Moderate | 10 of 5,000 | 15.8% | 25.9% |
| High | 5 of 5,000 | 29.8% | 40.8% |

Two readings matter. The number of participants who are *active at equilibrium* is single-digit to low-double-digit regardless of how many could have entered — adding potential entrants does not proportionally add real ones, because the extra mass is priced out. And the share of the pool that is *not* competed away is not a saving returned to the protocol or its users. It is profit, captured by the same small set of operators.

![Two bar charts with error bars: median active operators out of 5,000 falls from 18 to 5 as cost dispersion rises, while the share of the pool captured as operator profit rises from about 10 percent to 30 percent.](/research/points-participation.svg "As cost dispersion widens, fewer operators stay active and they keep more of the pool. Bars are medians of 500 draws; whiskers span the 5th to 95th percentile.")

For anyone doing diligence on a token distribution, this reframes the question. Wallet counts and points-holder counts describe who showed up, not who gets paid. A program built on continuous, uncapped accumulation should be underwritten as an allocation to roughly ten counterparties, and priced accordingly.

## The one lever that moves anything

If dissipation is fixed by the number of competitors, what does design actually control? Where the burned dollars land.

Split the cost of acquiring a point into the part paid to the protocol as a fee, and the part that leaves the system as gas, bridge cost, or slippage paid to third parties. Total waste is identical either way. The split is not.

![Stacked bar chart comparing four points designs, where protocol revenue rises from fifty thousand dollars under volume denomination to nine hundred sixty thousand under fee denomination, out of a constant amount dissipated.](/research/points-denomination.svg "Same dissipation, four destinations. Denomination decides who keeps it.")

On a million-dollar pool, all four designs burn the same $990k. Points denominated on raw volume send $49.5k of that to the protocol, because the cheapest way to manufacture volume is a wash trade whose cost is mostly slippage paid to someone else. Points denominated on fees paid send up to $960k, because the cost of earning a point is the fee itself.

Stated honestly, this is a narrower claim than it first appears. Denomination changes who keeps the value. It does not widen the set of people who capture the pool. A fee-denominated program still concentrates.

## The anti-sybil device that creates the sybil problem

Here is the result we found most surprising.

If points are strictly proportional to fees paid, splitting a fixed budget across many wallets earns exactly the same total. The pool share is invariant to wallet count — sybil-neutral by construction, with no detection system required.

Now add the standard defensive feature: a bonus on the first few thousand points of *each wallet*. That single addition makes splitting profitable, because a farmer can re-trigger the capped bonus once per wallet. Splitting a fixed budget across a thousand wallets now pays between 1.10 and 1.23 times as much, depending on how much competing effort is in the contest.

The mechanism designed to fight sybils is what creates the incentive to be one. Remove per-wallet floors and bonuses from the pro-rata core, and sybil detection stops being load-bearing for this margin, because splitting no longer pays.

## What this does not establish

No number in this work is calibrated against an observed points program. It is a model, solved exactly and checked carefully, not a measurement.

The checking is worth being precise about. We ran four verification procedures against the equilibrium, and three of them share the model's own first-order condition — only a brute-force grid search over deviations does not. Together they establish that our solver correctly solves the stated game. They do not establish that the game describes reality.

The model does make a sharply falsifiable prediction — the share of allocated supply going to the top ten recipients — and that quantity is public for completed programs. Testing it against them is the obvious next step and we have not done it. If the fit is poor, that is a finding.

## What we do with it

Suwappu's own [seasons program](/pricing) denominates points in fees paid rather than volume, which follows directly from the result above and means points are not diluted by wash trading. Engagement bonuses are kept small and capped specifically to avoid recreating the per-wallet incentive described here.

We should apply the model to ourselves as well as to others: it says our program concentrates too, and we do not claim an exemption. The design decision it supports is about where dissipated value lands, not about whether a distribution ends up broad.

If you are launching an incentive program on top of our [API](/docs) or [agent surface](/agents), the practical summary is short. Denominate in fees, not volume. Do not add per-wallet floors. Do not expect caps to reduce farming. And model the outcome as an allocation to a handful of professional operators, because that is what the equilibrium predicts.

## Reproducing this

The model, the exact equilibrium solver, the Monte Carlo, and the verification suite are released with fixed random seeds, so the numbers in this post are bit-reproducible. No network access is required to re-run any of it.

---

*Disclosures: this is research, not investment advice. Suwappu operates a points program of the type analyzed here, and the design this work recommends is the one we ship — treat that as an interested party's claim and check the argument rather than the source. Points-to-token conversion in our program is gated to a future token event and has not occurred, so no outcome data from it informs any result above.*`;

export const researchPosts: ResearchPost[] = [
  {
    slug: 'omnichain-dollar-collateral',
    title: 'What actually backs an omnichain dollar: measuring USDT0 across 17 chains',
    date: '2026-07-26',
    category: 'Security',
    excerpt: 'We read USDT0 collateral and cross-chain supply from chain state for twelve months. Completing the deployment universe removed 98% of the surplus we first reported.',
    readMins: 9,
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
    excerpt: 'A pro-rata points pool is captured by five to eighteen operators out of five thousand. Caps do not help; only fee denomination changes where the value lands.',
    readMins: 7,
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
