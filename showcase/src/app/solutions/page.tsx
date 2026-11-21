import type { Metadata } from 'next';
import SummerNav from '@/components/SummerNav';
import SummerFooter from '@/components/SummerFooter';
import { TELEGRAM_URL } from '@/lib/links';
import stats from '@/data/stats.generated.json';
import { Reveal, Backdrop, CountUp, RouteMap, ChainRing, AuthorityFlow, ProblemStrip } from '@/components/v3';
import '../sales-v3.css';
import styles from './solutions.module.css';

/** One distinct schematic per solution (ids match `solutions`). Real names only. */
const visuals: Record<string, React.ReactNode> = {
  trading: <RouteMap />,
  portfolio: (
    <ChainRing>
      <span className="sv3-ringnum"><CountUp value={stats.agentApiChains} /></span>
      <span className="sv3-ringlabel">chains</span>
    </ChainRing>
  ),
  payments: <AuthorityFlow lanes={[['Call', 'Credits', 'Result'], ['Empty', 'HTTP 402', 'Top up']]} />,
  wallets: (
    <AuthorityFlow lanes={[['App', 'Policy', 'Signer'], ['Signer', 'Signature', 'Chain']]} />
  ),
};

export const metadata: Metadata = {
  title: 'Solutions',
  description:
    `What you can build with the Suwappu Agent API: trading agents, portfolio agents, payment & commerce agents, and embedded wallets: across ${stats.agentApiChains} chains.`,
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
    body: `Give a strategy: human-written or fully autonomous: the ability to quote and execute swaps across ${stats.agentApiChains} chains, inside spend and slippage limits you set. The same two calls whether it runs once a day or once a second.`,
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
    body: 'Pull live token prices and cross-chain portfolio balances your agent can reason over, decide when a position has drifted, then rebalance in the same session: no separate data provider to stitch in.',
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
    body: 'Pay per call with prepaid credits: no subscription, an API key is still required. The API returns HTTP 402 when credits run out, and you top up with a USDC transaction hash. On-chain per-request payment (x402 header) is built but not enabled yet.',
    flow: ['Register for a key', 'Call with credits', 'Get HTTP 402 when empty', 'Top up'],
    file: 'credits.sh',
    code: `# Check your prepaid balance (a quote costs 1 credit, a swap 5)
curl https://api.suwappu.bot/v1/agent/billing \\
  -H "Authorization: Bearer $SUWAPPU_API_KEY"

# Out of credits? Calls return HTTP 402. Pay USDC, then credit the tx hash:
curl -X POST https://api.suwappu.bot/v1/agent/billing/topup \\
  -H "Authorization: Bearer $SUWAPPU_API_KEY" -H "Content-Type: application/json" \\
  -d '{"txHash":"0xYOUR_PAYMENT_TX","chain":"base","amount":5}'`,
    cta: { label: 'Credits and billing docs', href: '/docs/billing/agentic-payments' },
  },
  {
    id: 'wallets',
    eyebrow: "For apps that don't want to touch keys",
    title: 'Embedded wallets',
    body: 'Provision a server-side wallet signed via Turnkey for your users or your agent, with per-key spend limits and allowed chains/pairs: your app or agent never handles a private key. Prefer full self-custody instead? Request an unsigned transaction and sign it yourself.',
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

/** The code surface is the proof artifact: dark register, one per row. */
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
    <div className="summer-page docs-shell institutional-page v3-tone-light sv3-page">
      <SummerNav />
      <main id="main-content">
      <div className="summer-shell mkt-page">
        <div className="sv3-heroband"><Backdrop kind="grid" /><header className="mkt-hero">
          <h1>Quote, swap and settle from one API key.</h1>
          <p className="mkt-hero__lead">
            Trading, portfolio, pay-per-call or wallets: one REST API, MCP server and A2A protocol
            across {stats.agentApiChains} chains.
          </p>
          <div className="summer-actions">
            <a className="summer-button summer-button--primary" href="/start">Get an API key</a>
            <a className="summer-button summer-button--secondary" href="/docs/quick-start/overview">Read the quick start</a>
          </div>
</header></div>

        <div className={styles.rows}>
          {/* Lead row gets the terminal treatment: the trading loop is the
              reason most readers are here, so its code runs full width
              instead of squeezing into a side column. */}
          <section className={`${styles.row} ${styles.rowLead}`} id={lead.id}>
            <div className={styles.leadHead}>
              <div className={styles.copy}>
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
            <Reveal className="sv3-stage sv3-stage--wide">{visuals[lead.id]}</Reveal>
            <Reveal><CodeBlock file={lead.file} code={lead.code} /></Reveal>
          </section>

          {rest.map((s, i) => (
            <section
              className={`${styles.row} ${styles.rowSplit}${i % 2 ? ` ${styles.codeFirst}` : ''}`}
              id={s.id}
              key={s.id}
            >
              <div className={styles.copy}>
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
              <Reveal className={`sv3-col ${styles.col}`}>
                <div className="sv3-stage">{visuals[s.id]}</div>
                <CodeBlock file={s.file} code={s.code} />
              </Reveal>
            </section>
          ))}
        </div>

        <section className="mkt-cta">
          <h2>Pick your lane. Start in a minute.</h2>
          <div className="summer-actions summer-cta__actions">
            <a className="summer-button summer-button--primary" href="/start">
              Get an API key
            </a>
            <a className="summer-button summer-button--secondary" href={TELEGRAM_URL} target="_blank" rel="noopener noreferrer">
              Open Telegram Bot
            </a>
            <a className="summer-button summer-button--secondary" href="/pricing">See pricing</a>
          </div>
        </section>
      </div>
      <div className="summer-shell"><ProblemStrip surface="solutions" slugs={["let-ai-agent-swap-tokens", "spending-limits-ai-agent-wallet", "simulate-swap-before-signing"]} /></div>
      </main>
      <SummerFooter />
    </div>
  );
}
