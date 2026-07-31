import type { Metadata } from 'next';
import Navigation from '@/components/Navigation';
import SummerFooter from '@/components/SummerFooter';
import { TELEGRAM_URL } from '@/lib/links';
import stats from '@/data/stats.generated.json';
import styles from './solutions.module.css';

export const metadata: Metadata = {
  title: 'Solutions — Suwappu',
  description:
    `What you can build with the Suwappu Agent API: trading agents, portfolio agents, payment & commerce agents, and embedded wallets — across ${stats.agentApiChains} chains.`,
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
    body: `Give a strategy — human-written or fully autonomous — the ability to quote and execute swaps across ${stats.agentApiChains} chains, inside spend and slippage limits you set. The same two calls whether it runs once a day or once a second.`,
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

/** The code surface is the proof artifact — dark register, one per row. */
function CodeBlock({ file, code }: { file: string; code: string }) {
  return (
    <div className={styles.codeShell}>
      <div className="summer-code sw-card-dark" aria-label={file}>
        <div className="summer-code__bar">
          <span />
          <span />
          <span />
          <b>{file}</b>
        </div>
        <pre>
          <code>{code}</code>
        </pre>
      </div>
    </div>
  );
}

export default function SolutionsPage() {
  const [lead, ...rest] = solutions;

  return (
    <main id="main-content" className="summer-page docs-shell sw-dark">
      <Navigation />
      <div className="summer-shell mkt-page">
        <header className="mkt-hero mkt-hero--center">
          <p className="summer-kicker">Solutions</p>
          <h1>Quote, swap, and settle on {stats.agentApiChains} chains from one API key.</h1>
          <p className="mkt-hero__lead">
            Trading, portfolio management, pay-per-call commerce, or a wallet your app never has
            to secure itself — the same REST API, MCP server, and A2A protocol cover all four.
          </p>
        </header>

        <div className={styles.rows}>
          {/* Lead row gets the terminal treatment: the trading loop is the
              reason most readers are here, so its code runs full width
              instead of squeezing into a side column. */}
          <section className={`${styles.row} ${styles.rowLead}`} id={lead.id}>
            <div className={styles.leadHead}>
              <div className={styles.copy}>
                <p className="sw-kicker">{lead.eyebrow}</p>
                <h2 className={styles.title}>{lead.title}</h2>
                <p className={styles.body}>{lead.body}</p>
                <a
                  className={`summer-button summer-button--secondary ${styles.cta}`}
                  href={lead.cta.href}
                  {...(lead.cta.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                >
                  {lead.cta.label}
                </a>
              </div>
              <div className="summer-flow">
                {lead.flow.map((step, idx) => (
                  <div key={step}>
                    <span>0{idx + 1}</span>
                    <strong>{step}</strong>
                  </div>
                ))}
              </div>
            </div>
            <CodeBlock file={lead.file} code={lead.code} />
          </section>

          {rest.map((s, i) => (
            <section
              className={`${styles.row} ${styles.rowSplit}${i % 2 ? ` ${styles.codeFirst}` : ''}`}
              id={s.id}
              key={s.id}
            >
              <div className={styles.copy}>
                <p className="sw-kicker">{s.eyebrow}</p>
                <h2 className={styles.title}>{s.title}</h2>
                <p className={styles.body}>{s.body}</p>
                <div className="summer-flow">
                  {s.flow.map((step, idx) => (
                    <div key={step}>
                      <span>0{idx + 1}</span>
                      <strong>{step}</strong>
                    </div>
                  ))}
                </div>
                <a
                  className={`summer-button summer-button--secondary ${styles.cta}`}
                  href={s.cta.href}
                  {...(s.cta.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                >
                  {s.cta.label}
                </a>
              </div>
              <CodeBlock file={s.file} code={s.code} />
            </section>
          ))}
        </div>

        <section className="mkt-cta">
          <h2>Pick your lane. Start in a minute.</h2>
          <div className="summer-actions summer-cta__actions">
            <a className="summer-button summer-button--primary" href="/docs/quick-start/overview">
              Get an API key
            </a>
            <a className="summer-button summer-button--secondary" href={TELEGRAM_URL} target="_blank" rel="noopener noreferrer">
              Open Telegram Bot
            </a>
            <a className="summer-button summer-button--secondary" href="/pricing">See pricing</a>
          </div>
        </section>
      </div>
      <SummerFooter />
    </main>
  );
}
