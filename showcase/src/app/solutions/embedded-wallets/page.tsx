import type { Metadata } from 'next';
import SpokeLayout, { type SpokeContent } from '@/components/solutions/SpokeLayout';

export const metadata: Metadata = {
  title: 'Embedded wallets | Suwappu',
  description:
    'Server-side wallets signed via Turnkey, with policies that cap spend per time window or restrict which addresses they can reach. Your app never handles a private key.',
};

const content: SpokeContent = {
  kicker: "For apps that don't want to touch keys",
  h1: "Ship wallets your app never has to secure.",
  lead: 'Provision a server-side wallet signed via Turnkey for your users or your agent, then attach a policy that caps spend per time window or whitelists the addresses it may reach. Prefer full self-custody? Request an unsigned transaction and sign it yourself.',
  statLine: 'Two policy types: spending limits and address whitelists.',
  problem: {
    heading: "What you'd otherwise carry",
    body: 'The moment your app holds a private key, it inherits a security programme. Key generation and storage, signing infrastructure that stays available, policy enforcement that cannot be bypassed by a bug in your own call site, a recovery story for when something is lost, and an audit trail good enough to answer questions later. None of that is the product you set out to build.',
  },
  flow: ['Create wallet', 'Set policy', 'Get quote', 'Execute via quote_id'],
  buildVsBuy: {
    rows: [
      'Key generation and storage',
      'Signing infrastructure',
      'Policy enforcement',
      'Recovery',
      'Audit trail',
    ],
  },
  limits: [
    {
      title: 'Spending limits',
      body: 'A spending_limit policy takes a maxAmountWei cap and a timeWindowSeconds window, and is enforced at signing time rather than by your calling code.',
    },
    {
      title: 'Address whitelists',
      body: 'A whitelist policy restricts the addresses a wallet may transact with. Anything outside the list is refused at the signer, not filtered client-side.',
    },
    {
      title: 'Self-custody option',
      body: 'Managed wallets are optional. Request an unsigned transaction instead and sign it with your own keys, keeping the routing and quoting but none of the custody.',
    },
  ],
  snippet: {
    file: 'create-wallet.sh',
    code: `curl -X POST https://api.suwappu.bot/v1/agent/wallets \\
  -H "Authorization: Bearer suwappu_sk_YOUR_KEY"
# { "success": true, "wallet": { "address": "0x…", "chain_type": "evm" } }

curl -X POST https://api.suwappu.bot/v1/agent/wallet/policy \\
  -H "Authorization: Bearer suwappu_sk_YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"type":"spending_limit","params":{"maxAmountWei":"1000000000000000000","timeWindowSeconds":86400}}'`,
  },
  faqs: [
    {
      q: 'Who holds the keys?',
      a: 'Managed wallets are signed via Turnkey in a sub-organisation scoped to your agent. Your application never receives or stores the private key, and neither does your own server.',
    },
    {
      q: 'What if I want full self-custody instead?',
      a: 'Skip managed wallets. Request an unsigned transaction from the quote, then sign and broadcast it yourself. You keep the routing and pricing without moving custody anywhere.',
    },
    {
      q: 'What policy types exist?',
      a: 'Two today. A spending_limit with maxAmountWei and timeWindowSeconds, and an address whitelist restricting where the wallet may send. List what is attached with GET /v1/agent/wallet/policies.',
    },
    {
      q: 'Where are policies enforced?',
      a: 'At the signer. A policy is not a check in your calling code that a bug can skip, so a mistake in your own logic still cannot move more than the cap allows.',
    },
    {
      q: 'Does creating a wallet take any parameters?',
      a: 'No. POST /v1/agent/wallets creates the wallet for the authenticated agent and returns a wallet object with its address and chain_type. Policies are attached afterwards as a separate call.',
    },
  ],
  docsCta: { label: 'Managed wallets guide', href: '/docs/guides/managed-wallets' },
};

export default function EmbeddedWalletsPage() {
  return <SpokeLayout content={content} />;
}
