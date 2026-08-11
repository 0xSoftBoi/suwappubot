import type { Metadata } from 'next';
import SpokeLayout, { type SpokeContent } from '@/components/solutions/SpokeLayout';
import stats from '@/data/stats.generated.json';

export const metadata: Metadata = {
  title: 'Trading agents | Suwappu',
  description: `Give a trading strategy an execution layer: quote and swap across ${stats.agentApiChains} chains from one API key, inside the spend and slippage limits you set.`,
};

const content: SpokeContent = {
  kicker: 'For autonomous strategies',
  h1: "Give your strategy an execution layer it doesn't have to maintain.",
  lead: `Quote and execute swaps across ${stats.agentApiChains} chains from one key. Every trade runs inside the spend and slippage limits you set, whether the strategy fires once a day or once a second.`,
  statLine: `${stats.agentApiChains} chains, one API key.`,
  problem: {
    heading: "What you'd otherwise carry",
    body: `A trading strategy shouldn't also be a router-integration project. Without an execution layer, your team owns the router integrations for every chain you support, the logic to race and compare quotes, nonce and gas handling per chain, retries when a transaction reverts, and the key storage for whatever wallet signs the trade. Routing is chain-gated: a given swap is priced against up to ${stats.routerCount} routing venues, depending on the chain and pair.`,
  },
  flow: ['Register agent', 'Set spend policy', 'Request a quote', 'Execute the swap'],
  buildVsBuy: {
    rows: [
      'Router integrations',
      'Quote racing and comparison',
      'Nonce and gas handling per chain',
      'Retry on revert',
      'Key custody',
    ],
  },
  limits: [
    {
      title: 'Spend limits',
      body: 'Attach a spending_limit policy with a maxAmountWei cap and a timeWindowSeconds window. A managed wallet cannot move more than that in a given window.',
    },
    {
      title: 'Slippage',
      body: 'Pass a slippage value on the quote request, or accept the default. Execute only ever honors the terms already priced into that quote_id, not a re-priced trade.',
    },
    {
      title: 'Custody boundary',
      body: "Use a Suwappu-managed wallet signed via Turnkey, or request an unsigned transaction and sign it yourself for full self-custody.",
    },
  ],
  snippet: {
    file: 'trading-agent.ts',
    code: `import { Suwappu } from "@suwappu/sdk";

const client = new Suwappu({ apiKey: process.env.SUWAPPU_API_KEY });

const quote = await client.getQuote({
  from: "USDC", to: "ETH", chain: "base", amount: "500",
});
const tx = await client.swap(quote);
console.log(tx.txHash, tx.status);   // -> 0x… "completed"`,
  },
  faqs: [
    {
      q: 'Is there a self-custody option?',
      a: 'Yes. Request a quote and an unsigned transaction instead of a managed swap, then sign and broadcast it with your own keys. Nothing about the quote or routing logic changes.',
    },
    {
      q: 'Which chains are supported?',
      a: `${stats.agentApiChains} chains through one API key. Call GET /v1/agent/chains for the current, authoritative list rather than hardcoding it.`,
    },
    {
      q: 'How are routes chosen?',
      a: `Suwappu races the routing venues available for the chain and pair, up to ${stats.routerCount} across the platform, and returns the best price it finds. Not every chain has every router; coverage is chain-gated.`,
    },
    {
      q: 'What happens on a failed swap?',
      a: 'Swap status moves through states like "confirming" before landing on "completed" or "failed". Poll GET /v1/agent/swap/status/:id, or register a callback_url and get a signed webhook event instead of polling.',
    },
    {
      q: 'Are there rate limits?',
      a: 'Yes, per agent key. A 30-day Pro, Premium, or Enterprise window raises the limit; see the Agent API pricing section for current tiers.',
    },
  ],
  docsCta: { label: 'Trading bot guide', href: '/docs/guides/building-a-trading-bot' },
};

export default function TradingAgentsPage() {
  return <SpokeLayout content={content} />;
}
