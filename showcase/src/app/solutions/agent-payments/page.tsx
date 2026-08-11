import type { Metadata } from 'next';
import SpokeLayout, { type SpokeContent } from '@/components/solutions/SpokeLayout';

export const metadata: Metadata = {
  title: 'Agent payments | Suwappu',
  description:
    'Charge agents per call. Bearer keys draw down prepaid credits, and metered payments answer a caller with no credits with a signed HTTP 402 challenge.',
};

const content: SpokeContent = {
  kicker: 'For pay-per-call & micropayments',
  h1: 'Charge agents per call, without an account signup flow.',
  lead: 'Agents authenticate with a bearer key and draw down a prepaid credit balance. Turn on metered payments and a caller with no credits gets a signed HTTP 402 challenge instead of a result, settled in pathUSD on Tempo or in USDC over x402.',
  statLine: 'About a tenth of a cent per swap.',
  problem: {
    heading: "What you'd otherwise carry",
    body: 'Machine-to-machine billing is not a checkout page. Something has to issue a challenge and expire it, verify the payment landed on-chain, refuse a proof that has already been spent, keep a credit ledger that survives a restart, and refund the call when the underlying work fails. Each of those is a small problem, and all of them are on the money path.',
  },
  flow: ['Call the endpoint', 'Receive HTTP 402', 'Pay the challenge', 'Retry with proof'],
  buildVsBuy: {
    rows: [
      'Challenge issue and expiry',
      'On-chain payment verification',
      'Replay protection',
      'Credit ledger',
      'Refund on failed work',
    ],
  },
  limits: [
    {
      title: 'Bearer auth is the default',
      body: 'Today an unauthenticated call is rejected with 401. Metered payments are opt-in per deployment, so the 402 flow only appears once it is switched on.',
    },
    {
      title: 'Challenges expire',
      body: 'Each challenge carries a challenge_id and an expires_at. A proof presented after expiry is refused, and a spent proof cannot be replayed against a fresh challenge.',
    },
    {
      title: 'Refund on failure',
      body: 'A charged call that fails to produce the work is refunded to the agent balance rather than silently kept.',
    },
  ],
  snippet: {
    file: 'metered-call.sh',
    code: `curl -i -X POST https://api.suwappu.bot/v1/agent/quote \\
  -H "Authorization: Bearer suwappu_sk_YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"from_token":"USDC","to_token":"ETH","chain":"base","amount":"50"}'

# With metered payments enabled, a caller that is out of credits
# gets a challenge rather than a quote:
# HTTP/1.1 402 Payment Required
# X-Payment-Required: <base64 JSON challenge>
# Accept-Payment: x402 network=base asset=0x… payTo=0x…`,
  },
  faqs: [
    {
      q: 'Is the 402 flow live right now?',
      a: 'The flow ships in the API behind a configuration flag. With it off, which is the default, an unauthenticated call returns 401 and paid agents draw down prepaid credits instead. Ask us if you want it enabled for your deployment.',
    },
    {
      q: 'What is the actual response header?',
      a: 'X-Payment-Required, carrying a base64-encoded JSON challenge, alongside an Accept-Payment header describing the network, asset, and destination. The micropayment variant uses an x-402 header in the same base64 form.',
    },
    {
      q: 'What is pathUSD on Tempo?',
      a: 'A gasless stablecoin settlement path for micropayments, priced at about a tenth of a cent per swap. The same challenge also advertises on-chain x402 settlement in USDC if you would rather pay that way.',
    },
    {
      q: 'How is replay prevented?',
      a: 'Every challenge is issued with its own challenge_id and expiry, and a payment proof is recorded once it is verified. Presenting the same proof again, or against a newly issued challenge, is refused.',
    },
    {
      q: 'What happens if the swap fails after I have paid?',
      a: 'The charge for that call is refunded to the agent balance. You are not billed for work that did not happen.',
    },
  ],
  docsCta: { label: 'Agentic payments docs', href: '/docs/billing/agentic-payments' },
};

export default function AgentPaymentsPage() {
  return <SpokeLayout content={content} />;
}
