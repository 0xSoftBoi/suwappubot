import type { Metadata } from 'next';
import Navigation from '@/components/Navigation';
import SummerFooter from '@/components/SummerFooter';
import { TELEGRAM_URL } from '@/lib/links';

export const metadata: Metadata = {
  title: 'Solutions — Suwappu',
  description:
    'What you can build with the Suwappu Agent API: trading agents, portfolio agents, payment & commerce agents, and embedded wallets — across 15+ chains.',
};

const solutions: {
  id: string;
  eyebrow: string;
  title: string;
  body: string;
  flow: string[];
  file: string;
  code: string;
  cta: { label: string; href: string; external?: boolean };
}[] = [
  {
    id: 'trading',
    eyebrow: 'For autonomous strategies',
    title: 'Trading agents',
    body: 'Give a strategy — human-written or fully autonomous — the ability to quote and execute swaps across 15+ chains, inside spend and slippage limits you set. The same two calls whether it runs once a day or once a second.',
    flow: ['Register agent', 'Set spend policy', 'Request a quote', 'Execute the swap'],
    file: 'trading-agent.ts',
    code: `import { Suwappu } from "@suwappu/sdk";

const client = new Suwappu({ apiKey: process.env.SUWAPPU_API_KEY });

const quote = await client.getQuote({
  from: "USDC", to: "ETH", chain: "base", amount: "500",
});
const tx = await client.swap(quote);
console.log(tx.txHash, tx.status);   // -> 0x… "filled"`,
    cta: { label: 'Read the API docs', href: '/docs/api-reference/overview' },
  },
  {
    id: 'portfolio',
    eyebrow: 'For research & rebalancing',
    title: 'Portfolio agents',
    body: 'Pull live token prices and cross-chain portfolio balances your agent can reason over, decide when a position has drifted, then rebalance in the same session — no separate data provider to stitch in.',
    flow: ['Get portfolio', 'Get prices', 'Decide & quote', 'Execute rebalance'],
    file: 'portfolio-check.sh',
    code: `curl https://api.suwappu.bot/v1/agent/portfolio \\
  -H "Authorization: Bearer suwappu_sk_YOUR_KEY"
# { "success": true, "chains": [...], "total_usd": "12,480.55" }

curl https://api.suwappu.bot/v1/agent/prices?tokens=ETH,SOL,BTC \\
  -H "Authorization: Bearer suwappu_sk_YOUR_KEY"`,
    cta: { label: 'Portfolio rebalancer guide', href: '/docs/guides/portfolio-rebalancer' },
  },
  {
    id: 'payments',
    eyebrow: 'For pay-per-call & micropayments',
    title: 'Payment & commerce agents',
    body: 'Pay per request over HTTP 402 with x402 — no signup, no subscription, no API key handshake — or settle in gasless stablecoin micropayments on Tempo for about a tenth of a cent per swap. Built for agents that transact machine-to-machine.',
    flow: ['Call the endpoint', 'Receive HTTP 402', 'Pay in USDC', 'Get the result'],
    file: 'x402-call.sh',
    code: `curl -i https://api.suwappu.bot/v1/agent/quote \\
  -d '{"from_token":"USDC","to_token":"ETH","chain":"base","amount":"50"}'
# HTTP/1.1 402 Payment Required
# X-Payment: { "amount": "0.001", "asset": "USDC", "chain": "base" }

# Pay the invoice, then retry with the payment proof attached —
# no registration, no API key, charged per call.`,
    cta: { label: 'Agentic Payments (x402) docs', href: '/docs/billing/agentic-payments' },
  },
  {
    id: 'wallets',
    eyebrow: "For apps that don't want to touch keys",
    title: 'Embedded wallets',
    body: 'Provision a server-side wallet signed via Turnkey for your users or your agent, with per-key spend limits and allowed chains/pairs — your app or agent never handles a private key. Prefer full self-custody instead? Request an unsigned transaction and sign it yourself.',
    flow: ['Create wallet', 'Set policy', 'Get quote', 'Execute via quote_id'],
    file: 'create-wallet.sh',
    code: `curl -X POST https://api.suwappu.bot/v1/agent/wallets \\
  -H "Authorization: Bearer suwappu_sk_YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"chain":"base","policy":{"max_spend_usd":"1000","allowed_pairs":["USDC/ETH"]}}'
# { "success": true, "wallet_id": "w_abc123", "address": "0x..." }`,
    cta: { label: 'Managed wallets guide', href: '/docs/guides/managed-wallets' },
  },
];

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-card border border-white/10 bg-[var(--canvas-2)] p-6 ${className}`}>{children}</div>
  );
}

export default function SolutionsPage() {
  return (
    <main id="main-content" className="min-h-screen bg-[var(--canvas-0)] text-[var(--ink-0)]">
      <Navigation />
      <div className="mx-auto max-w-7xl px-6 pb-24">
        {/* ── HERO ── */}
        <header className="mx-auto max-w-2xl pt-16 pb-12 text-center md:pt-24">
          <p className="text-xs font-medium uppercase tracking-wide text-[var(--accent)]">Solutions</p>
          <h1 className="mt-3 text-4xl font-medium tracking-tight md:text-5xl">
            One API. Every agent job to be done.
          </h1>
          <p className="mx-auto mt-5 max-w-lg text-base leading-relaxed text-[var(--ink-1)]">
            Trading, portfolio management, pay-per-call commerce, or a wallet your app never has
            to secure itself — the same REST API, MCP server, and A2A protocol cover all four.
          </p>
        </header>

        {/* ── SOLUTION SECTIONS ── */}
        <div className="mt-8 flex flex-col gap-20 md:mt-16 md:gap-28">
          {solutions.map((s, i) => (
            <section
              id={s.id}
              key={s.id}
              className="grid grid-cols-1 items-center gap-10 scroll-mt-24 md:grid-cols-2 md:gap-14"
            >
              <div className={i % 2 ? 'md:order-2' : ''}>
                <p className="text-xs font-medium uppercase tracking-wide text-[var(--accent)]">{s.eyebrow}</p>
                <h2 className="mt-2 text-2xl font-medium tracking-tight md:text-3xl">{s.title}</h2>
                <p className="mt-4 text-sm leading-relaxed text-[var(--ink-1)] md:text-base">{s.body}</p>
                <div className="mt-6 grid grid-cols-2 gap-3">
                  {s.flow.map((step, idx) => (
                    <div key={step} className="rounded-control border border-white/10 bg-[var(--canvas-1)] px-3 py-2.5">
                      <span className="text-xs font-medium text-[var(--accent)]">0{idx + 1}</span>
                      <p className="mt-0.5 text-sm font-medium text-[var(--ink-0)]">{step}</p>
                    </div>
                  ))}
                </div>
                <a
                  href={s.cta.href}
                  {...(s.cta.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                  className="mt-6 inline-flex items-center justify-center rounded-control border border-white/10 px-4 py-2.5 text-sm font-medium text-[var(--ink-0)] transition-colors hover:bg-white/5"
                >
                  {s.cta.label}
                </a>
              </div>
              <div className={i % 2 ? 'md:order-1' : ''}>
                <div className="overflow-hidden rounded-card border border-white/10 bg-[var(--canvas-2)]">
                  <div className="flex items-center gap-2 border-b border-white/10 bg-[var(--canvas-1)] px-4 py-3">
                    <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
                    <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
                    <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
                    <b className="ml-2 font-mono text-xs text-[var(--ink-1)]">{s.file}</b>
                  </div>
                  <pre className="overflow-x-auto p-4 text-xs leading-relaxed">
                    <code className="font-mono text-[var(--ink-0)]">{s.code}</code>
                  </pre>
                </div>
              </div>
            </section>
          ))}
        </div>

        {/* ── CTA ── */}
        <section className="mt-20 flex flex-col items-center gap-6 rounded-panel border border-white/10 bg-[var(--canvas-1)] px-6 py-14 text-center">
          <h2 className="max-w-lg text-2xl font-medium tracking-tight md:text-3xl">
            Pick your lane. Start in a minute.
          </h2>
          <div className="flex flex-wrap justify-center gap-3">
            <a
              href="/docs/quick-start/overview"
              className="rounded-control bg-[var(--accent)] px-5 py-2.5 text-sm font-medium text-[#1a1108] transition-colors hover:bg-[var(--accent-hover)] active:scale-[0.98]"
            >
              Get an API key
            </a>
            <a
              href={TELEGRAM_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-control border border-white/10 px-5 py-2.5 text-sm font-medium text-[var(--ink-0)] transition-colors hover:bg-white/5"
            >
              Open Telegram Bot
            </a>
            <a
              href="/pricing"
              className="rounded-control border border-white/10 px-5 py-2.5 text-sm font-medium text-[var(--ink-0)] transition-colors hover:bg-white/5"
            >
              See pricing
            </a>
          </div>
        </section>
      </div>
      <SummerFooter />
    </main>
  );
}
