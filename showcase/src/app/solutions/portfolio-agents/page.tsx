import type { Metadata } from 'next';
import SpokeLayout, { type SpokeContent } from '@/components/solutions/SpokeLayout';
import stats from '@/data/stats.generated.json';

export const metadata: Metadata = {
  title: 'Portfolio agents | Suwappu',
  description: `Read live prices and cross-chain balances across ${stats.agentApiChains} chains, decide when a position has drifted, and rebalance on the same key.`,
};

const content: SpokeContent = {
  kicker: 'For research & rebalancing',
  h1: 'Read the whole portfolio, decide, and rebalance in one session.',
  lead: `Live prices and cross-chain balances your agent can reason over, with execution on the same key. No second data vendor to stitch in, and no reconciling one provider's view of a wallet against another's.`,
  statLine: `${stats.agentApiChains} chains in a single call.`,
  problem: {
    heading: "What you'd otherwise carry",
    body: 'Reading a portfolio is the unglamorous half of a rebalancing agent. Without one call that returns it, your team indexes balances per chain, sources and reconciles a price feed, normalises everything to USD, decides what counts as drift, and then hands the result to a completely separate execution path that may disagree about which wallet it is even looking at.',
  },
  flow: ['Get portfolio', 'Get prices', 'Decide & quote', 'Execute rebalance'],
  buildVsBuy: {
    rows: [
      'Per-chain balance indexing',
      'Price feed sourcing',
      'USD normalisation',
      'Drift detection inputs',
      'Execution on the same key',
    ],
  },
  limits: [
    {
      title: 'Read scope',
      body: 'Portfolio reads take an optional wallet_address and chain filter. Narrow the read to one chain when a strategy only cares about one, rather than paying for a full sweep.',
    },
    {
      title: 'Same policy applies',
      body: 'A rebalance is a swap. It runs under the same spending_limit and address policies attached to the wallet, so a drift calculation gone wrong still cannot exceed the cap you set.',
    },
    {
      title: 'Custody boundary',
      body: 'Reading a portfolio never requires custody. You can read balances for a wallet you do not control, then execute only against the managed wallet you do.',
    },
  ],
  snippet: {
    file: 'portfolio-check.sh',
    code: `curl https://api.suwappu.bot/v1/agent/portfolio \\
  -H "Authorization: Bearer suwappu_sk_YOUR_KEY"
# { "success": true, "wallet_address": "0x…", "wallet_type": "evm",
#   "total_usd": "12480.55", "balances": [...] }

curl "https://api.suwappu.bot/v1/agent/prices?symbols=ETH,SOL,BTC" \\
  -H "Authorization: Bearer suwappu_sk_YOUR_KEY"`,
  },
  faqs: [
    {
      q: 'Which tokens can I price?',
      a: 'Pass a comma-separated symbol list to GET /v1/agent/prices with the symbols query parameter. Use GET /v1/agent/tokens to discover what is available on a given chain rather than assuming a symbol resolves.',
    },
    {
      q: 'Can it read a wallet I do not custody?',
      a: 'Yes. Portfolio reads accept a wallet_address, so an agent can analyse any address. Execution is a separate call and only ever runs against a wallet you control.',
    },
    {
      q: 'Does this cover Solana as well as EVM chains?',
      a: 'Yes. The response carries a wallet_type so your agent can branch on it, and the chains endpoint reports the type for every supported chain.',
    },
    {
      q: 'How is total_usd formatted?',
      a: 'As an unformatted decimal string, for example "12480.55". Parse it as a number rather than stripping separators, and do your own display formatting.',
    },
    {
      q: 'Can I get pushed updates instead of polling?',
      a: 'Register a webhook and receive signed events for swaps your agent executes. Portfolio and price reads are pull-based, so poll those on whatever interval your strategy needs.',
    },
  ],
  docsCta: { label: 'Portfolio rebalancer guide', href: '/docs/guides/portfolio-rebalancer' },
};

export default function PortfolioAgentsPage() {
  return <SpokeLayout content={content} />;
}
