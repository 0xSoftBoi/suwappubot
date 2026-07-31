// Research / writing feed. Published posts carry full markdown `body` (rendered
// with the same pipeline as the docs). "planned" posts show as upcoming on the
// index: credible roadmap, not fabricated content.

export type ResearchPost = {
  slug: string;
  title: string;
  date: string; // ISO; empty for planned
  category: 'Protocol' | 'Architecture' | 'Security' | 'Agents' | 'Benchmarks';
  excerpt: string;
  readMins?: number;
  status: 'published' | 'planned';
  body?: string;
};

const TEMPO_BODY = `# Gasless swaps on Tempo: how fee-payer (type 0x76) transactions actually work

Onboarding a new user to crypto has a chicken-and-egg problem: to make their first swap they need gas, but to get gas they usually need to already hold the native token. Tempo's fee-payer transaction type lets us cut that knot: a sponsor pays the gas so the user doesn't have to. This post walks through how Suwappu sponsors a user's first swaps, end to end.

## The problem with "just pay gas"

On most chains, every transaction must be signed by the account that pays for it. A brand-new wallet with a zero balance literally cannot broadcast anything. The usual workarounds: faucets, meta-transactions, ERC-4337 paymasters: each add moving parts.

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

# 3. Broadcast: user paid nothing for gas
receipt = await tempo.send(signed)
\`\`\`

Because Tempo settles in TIP-20 stablecoins and fees are sub-cent, the user's *total* cost on a sponsored swap is on the order of **$0.001**.

## Guardrails (so sponsorship is sustainable)

Sponsorship is a best-effort onboarding perk, not an unlimited faucet. It is bounded by:

- A small **per-user lifetime cap** on sponsored swaps.
- A **daily USD budget** across all users.
- A **graceful fallback**: if sponsorship is unavailable: budget exhausted, signer busy: the swap still executes, user-paid. Nothing ever blocks.

The accounting is intentionally best-effort (in-memory), so a restart resets counters. That's an acceptable trade for an onboarding perk; it is not a financial guarantee.

## Why this matters for agents

The same mechanism that smooths human onboarding matters even more for autonomous agents: an agent's first action shouldn't require pre-funding a gas account in the native asset. Fee-payer transactions let an agent transact in stablecoins from the first call.

## Takeaways

- Type \`0x76\` carries two signatures: sender and gas payer: in one transaction.
- Suwappu counter-signs gas for eligible first swaps via \`pytempo\`.
- It's bounded by per-user and daily limits, with a user-paid fallback.
- Net effect: a first swap that costs about a tenth of a cent, in stablecoins, with no native gas token required.
`;

const ROUTING_BODY = `# Best-price routing: how Suwappu picks the winning quote

"Cross-chain swap" is the easy part to say and the hard part to do well. Liquidity for any given pair is scattered across dozens of DEXes, aggregators, and bridges, each with different prices, gas, and reliability. Suwappu's job is to make that fragmentation invisible: to return the *best* quote, not the first one. Here's how the routing engine works.

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

The trick is in *normalize → rank*. A raw output amount is meaningless until you subtract everything that eats into it. We rank on **net output**: expected tokens out, minus gas, minus bridge/relayer fees, minus price impact, so a route that quotes a bigger number but costs more in gas doesn't win on a technicality.

## Same-chain vs cross-chain

The engine treats two cases:

- **Same-chain swaps** route through DEX aggregators (e.g. LiFi on EVM, Jupiter on Solana).
- **Cross-chain swaps** add a bridge leg: Across for speed, CCTP for native USDC, and the ranking accounts for bridge time and cost, not just the swap.

A single user intent ("swap X on chain A for Y on chain B") can therefore resolve to a multi-step route, quoted and priced as one number.

## MEV-aware execution

The best *quote* is wasted if the *fill* gets sandwiched. Where it helps, swaps can route through MEV-shielded venues (e.g. CoW) so the price you were quoted is closer to the price you get. Token-security heuristics and transaction simulation run before funds move.

## Why "best of N" is the whole product

Racing the field costs a little latency and a lot of integration work: every provider has its own API, quirks, and failure modes. But it's the difference between "we support N chains" and "we get you the best execution across N chains." For agents especially, that consistency matters: an autonomous caller can't eyeball a bad route, so the engine has to be the one that never takes one.

## Takeaways

- Suwappu races up to nine providers per swap and ranks on **net output**, not headline amount.
- Same-chain and cross-chain intents resolve through one ranked pipeline.
- MEV-shielding and pre-trade checks protect the fill, not just the quote.
- "Best of N" is the point: especially for agents that can't catch a bad route themselves.
`;

export const researchPosts: ResearchPost[] = [
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
    excerpt: 'Why we race up to nine aggregators per swap and rank on net output: not the headline amount: across same-chain and cross-chain routes.',
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
    excerpt: 'The design of an agent-facing swap surface: tool shape, quote/settlement contract, and the policy guardrails that keep autonomous execution in bounds.',
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
