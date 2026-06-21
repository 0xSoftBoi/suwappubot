import type { Metadata } from 'next';
import Navigation from '@/components/Navigation';
import SummerFooter from '@/components/SummerFooter';

export const metadata: Metadata = {
  title: 'For AI agents — Suwappu',
  description:
    'Cross-chain execution for autonomous agents: quote, swap, run perps, and manage portfolios across 40+ chains over MCP, a typed SDK, or REST. Discoverable via llms.txt and an agent card, non-custodial, with guardrails you define.',
};

const connect = [
  {
    title: 'MCP — drop into any agent host',
    body: 'Add one server block to Claude, Cursor, or any MCP client. Quotes, swaps, perps, and portfolio become agent-callable tools.',
    file: 'claude_desktop_config.json',
    code: `{
  "mcpServers": {
    "suwappu": {
      "command": "npx",
      "args": ["@suwappu/mcp-server"],
      "env": { "SUWAPPU_API_KEY": "sk_..." }
    }
  }
}`,
  },
  {
    title: 'TypeScript SDK — quote, then execute',
    body: 'Best-price routing across 40+ chains behind two calls. Use a managed wallet, or bring your own keys for full self-custody.',
    file: 'agent.ts',
    code: `import { Suwappu } from "@suwappu/sdk";

const client = new Suwappu({ apiKey: process.env.SUWAPPU_API_KEY });

const quote = await client.getQuote({
  from: "USDC", to: "ETH", chain: "base", amount: "1000",
});
const tx = await client.swap(quote);   // accepts a Quote or quote id
console.log(tx.txHash, tx.status);      // -> 0x… "filled"`,
  },
  {
    title: 'REST — one endpoint, any language',
    body: 'No SDK required. Authenticate with a bearer token and POST to the agent API. Full reference and OpenAPI in the docs.',
    file: 'quote.sh',
    code: `curl -X POST https://api.suwappu.bot/v1/agent/quote \\
  -H "Authorization: Bearer $SUWAPPU_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"from":"USDC","to":"ETH","chain":"base","amount":"1000"}'`,
  },
];

const capabilities = [
  { title: 'Swap', body: 'Best-price cross-chain routing across 40+ chains — every swap races LiFi, CoW, OKX, 1inch, KyberSwap, and Jupiter.' },
  { title: 'Perps', body: 'Open and manage HyperLiquid perpetuals up to 20x — take-profit, stop-loss, funding, and one-tap close, all over the API.' },
  { title: 'Prediction markets', body: 'Browse and trade Polymarket — live probabilities, volumes, and positions as structured tool calls.' },
  { title: 'Yield & lending', body: 'Scan Morpho markets and move into the best APY by chain without leaving the agent loop.' },
  { title: 'Portfolio', body: 'Read balances, positions, and PnL across chains — the inputs an autonomous strategy needs to decide.' },
  { title: 'Wallets', body: 'Managed wallets (keys encrypted, signed server-side) or bring-your-own-keys — the agent never has to handle a private key it should not.' },
];

const guardrails = [
  { title: 'Spending limits', body: 'Per-key and per-account caps so an autonomous agent can never move more than you allow.' },
  { title: 'Allowed chains & pairs', body: 'Constrain an agent to specific networks and token pairs — execution stays inside the rails you set.' },
  { title: 'Withdrawal allowlists', body: 'Funds can only leave to addresses you have pre-approved. No surprise destinations.' },
  { title: 'MEV-shielded routing', body: 'Route swaps MEV-shielded (e.g. CoW) with token-security checks and simulation before funds move.' },
];

const discovery = [
  { label: 'llms.txt', desc: 'Machine-readable map of every action', href: 'https://suwappu.bot/llms.txt' },
  { label: 'Agent card', desc: 'A2A-compatible capability manifest', href: '/docs/protocols/agent-card' },
  { label: 'MCP server', desc: '8 tools for any MCP host', href: '/docs/protocols/mcp' },
  { label: 'OpenAPI', desc: 'Typed spec for codegen & tooling', href: '/docs/protocols/openapi' },
];

export default function ForAgentsPage() {
  return (
    <main id="main-content" className="summer-page docs-shell">
      <Navigation />
      <div className="summer-shell mkt-page">
        <header className="mkt-hero mkt-hero--center">
          <p className="summer-kicker">Built for AI agents</p>
          <h1>Cross-chain execution, in one API call.</h1>
          <p className="mkt-hero__lead">
            Suwappu gives autonomous agents a single surface to quote, swap, run perps, and
            manage portfolios across 40+ chains — over MCP, a typed SDK, or REST. Discoverable
            by design, non-custodial, and wrapped in guardrails you define.
          </p>
          <div className="summer-actions summer-cta__actions">
            <a className="summer-button summer-button--primary" href="/docs/quick-start/overview">
              Read the API docs
            </a>
            <a className="summer-button summer-button--secondary" href="/docs/protocols/mcp">
              Connect an agent
            </a>
          </div>
        </header>

        <section aria-label="Ways to connect">
          <p className="summer-kicker">Three ways to connect</p>
          <h2 className="mkt-h2">Pick your surface. Same execution layer underneath.</h2>
          <div className="agents-connect">
            {connect.map((c) => (
              <article className="agents-connect__item" key={c.title}>
                <h2>{c.title}</h2>
                <p>{c.body}</p>
                <div className="summer-code" aria-label={c.file}>
                  <div className="summer-code__bar">
                    <span />
                    <span />
                    <span />
                    <b>{c.file}</b>
                  </div>
                  <pre>
                    <code>{c.code}</code>
                  </pre>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section aria-label="Agent capabilities">
          <p className="summer-kicker">What your agent can do</p>
          <h2 className="mkt-h2">One key. The whole on-chain surface.</h2>
          <div className="security-grid">
            {capabilities.map((c) => (
              <article className="security-card" key={c.title}>
                <h2>{c.title}</h2>
                <p>{c.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section aria-label="Guardrails">
          <p className="summer-kicker">Guardrails you define</p>
          <h2 className="mkt-h2">Autonomy, inside the rails.</h2>
          <div className="security-grid">
            {guardrails.map((g) => (
              <article className="security-card" key={g.title}>
                <h2>{g.title}</h2>
                <p>{g.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section aria-label="Discoverability">
          <p className="summer-kicker">Discoverable by design</p>
          <h2 className="mkt-h2">An LLM can find every action — no hand-holding.</h2>
          <div className="agents-verify">
            {discovery.map((d) => (
              <a key={d.label} href={d.href} target={d.href.startsWith('http') ? '_blank' : undefined} rel={d.href.startsWith('http') ? 'noopener noreferrer' : undefined}>
                <b>{d.label}</b>
                <span>{d.desc}</span>
              </a>
            ))}
          </div>
        </section>

        <section className="mkt-cta">
          <h2>Give your agent a wallet and a router.</h2>
          <div className="summer-actions summer-cta__actions">
            <a className="summer-button summer-button--primary" href="/docs/quick-start/first-swap">
              Start with a swap
            </a>
            <a
              className="summer-button summer-button--secondary"
              href="https://www.npmjs.com/package/@suwappu/sdk"
              target="_blank"
              rel="noopener noreferrer"
            >
              View the SDK on npm
            </a>
          </div>
        </section>
      </div>
      <SummerFooter />
    </main>
  );
}
