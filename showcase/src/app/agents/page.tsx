import type { Metadata } from 'next';
import Navigation from '@/components/Navigation';
import SummerFooter from '@/components/SummerFooter';
import FaqAccordion from '@/components/FaqAccordion';
import AgentQuickstart from './AgentQuickstart';
import { ENTERPRISE_CONTACT_PATH } from '@/lib/links';
import stats from '@/data/stats.generated.json';

export const metadata: Metadata = {
  title: 'Agents — Suwappu API, MCP & A2A for AI agents',
  description:
    `Onchain execution for AI agents: a REST API, an MCP server, and the A2A protocol for quotes, swaps, managed wallets, and portfolio across ${stats.agentApiChains} chains. Self-serve registration, pay-per-call with x402, no signup required.`,
};

// ── b. Capability grid ──────────────────────────────────────────────
const CAPABILITIES = [
  {
    title: `${stats.agentApiChains} chains`,
    body: 'EVM (Base, Ethereum, Arbitrum, Optimism, Polygon, BSC and more), Solana, TRON, and Tempo — one API, one bearer token.',
  },
  {
    title: 'Swap execution',
    body: 'Quote and execute in two calls. Best-price routing, unsigned-tx mode for self-custody, or managed-wallet mode for zero key handling.',
  },
  {
    title: 'Managed wallets & spending policies',
    body: 'Server-side wallets signed via Turnkey — your agent never touches a private key. Set per-key spend limits and allowed chains/pairs.',
  },
  {
    title: 'Real-time prices & portfolio',
    body: 'Live token prices and cross-chain portfolio balances your agent can reason over before it decides to trade.',
  },
  {
    title: 'Perps, predictions & lending',
    body: 'HyperLiquid perpetuals, Polymarket prediction markets, and Morpho lending markets — all callable from the same key.',
  },
  {
    title: 'Webhooks & swap history',
    body: 'Register a callback URL for signed swap-state events instead of polling, and pull full swap history with pagination.',
  },
];

// ── d. Integration comparison matrix ────────────────────────────────
const MATRIX_COLUMNS: { key: string; label: string; sub: string }[] = [
  { key: 'rest', label: 'REST API', sub: '/v1/agent/*' },
  { key: 'mcp', label: 'MCP', sub: 'POST /mcp' },
  { key: 'a2a', label: 'A2A', sub: 'POST /a2a' },
  { key: 'sdk', label: 'SDKs', sub: 'TS · Python' },
];

type Cell = 'yes' | 'partial' | 'no';
const CELL_GLYPH: Record<Cell, string> = { yes: '✓', partial: '~', no: '–' };
const CELL_WORD: Record<Cell, string> = { yes: 'Yes', partial: 'Partial', no: 'No' };

const MATRIX_ROWS: { label: string; cells: Record<string, Cell> }[] = [
  { label: 'Quotes', cells: { rest: 'yes', mcp: 'yes', a2a: 'yes', sdk: 'yes' } },
  { label: 'Swap execution', cells: { rest: 'yes', mcp: 'yes', a2a: 'yes', sdk: 'yes' } },
  { label: 'Portfolio & prices', cells: { rest: 'yes', mcp: 'yes', a2a: 'yes', sdk: 'yes' } },
  { label: 'Managed wallets & policies', cells: { rest: 'yes', mcp: 'no', a2a: 'no', sdk: 'yes' } },
  { label: 'Streaming / webhooks', cells: { rest: 'yes', mcp: 'no', a2a: 'partial', sdk: 'yes' } },
  { label: 'Self-registration (no signup)', cells: { rest: 'yes', mcp: 'no', a2a: 'no', sdk: 'yes' } },
  { label: 'Pay-per-call (x402)', cells: { rest: 'yes', mcp: 'no', a2a: 'no', sdk: 'no' } },
];

// ── e. Agentic payments ─────────────────────────────────────────────
const PAYMENT_MODES = [
  {
    title: 'Pay-per-call (x402)',
    body: 'Pay per request over HTTP 402 — no signup, no subscription, no API key handshake. Fund a wallet, call the endpoint, get charged for exactly what you use.',
  },
  {
    title: 'Prepaid credits',
    body: '1 credit ≈ $0.001. Reads (quotes, prices, portfolio) cost 1 credit; swaps cost 5 credits. Top up with USDC on Base whenever your balance runs low.',
  },
  {
    title: 'Subscription tiers',
    body: 'Crypto or Stripe fiat checkout for Pro ($9.99/mo), Premium ($29.99/mo), or Enterprise ($99.99/mo) — 30-day prepaid, stackable, and each tier raises your rate limit and lowers your swap fee.',
  },
];

// ── f. FAQ ───────────────────────────────────────────────────────────
const FAQS = [
  {
    q: 'What is the Suwappu MCP server?',
    a: 'A hosted Model Context Protocol endpoint at POST https://api.suwappu.bot/mcp that exposes 16+ tools — quotes, swap execution, portfolio, prices, chains, tokens, prediction markets, perps, lending, and Tempo tokens — as agent-callable tools over JSON-RPC 2.0. Any MCP-compatible client can call it without custom integration code.',
  },
  {
    q: 'Which AI clients work with it?',
    a: 'Any MCP-compatible host — Claude Desktop, Claude Code, Cursor, and Windsurf all connect with the same server block. Add the URL and your API key and the client discovers the tool list automatically.',
  },
  {
    q: "What's the difference between REST, MCP, and A2A?",
    a: 'REST is the full, typed surface — every endpoint, every parameter, for custom backends and SDKs. MCP wraps a subset of that surface as LLM tool calls for agent hosts. A2A is JSON-RPC for agent-to-agent messaging — send natural language like "swap 0.5 ETH to USDC on base" and get back a structured task. All three share the same auth, wallets, and execution engine.',
  },
  {
    q: 'Which chains are supported?',
    a: `${stats.agentApiChains} chains through one API, including EVM networks (Base, Ethereum, Arbitrum, Optimism, Polygon, BSC and more), Solana, TRON, and Tempo. Call GET /v1/agent/chains for the authoritative, current list rather than hardcoding it.`,
  },
  {
    q: 'What does it cost?',
    a: 'Three ways to pay: pay-per-call over HTTP 402 (x402) with no signup, prepaid credits (1 credit ≈ $0.001 — reads cost 1 credit, swaps cost 5), or a monthly subscription (Pro/Premium/Enterprise) that raises your rate limit and lowers your swap fee. See the Agent API section on the pricing page for the full breakdown.',
  },
  {
    q: 'How do managed wallets work?',
    a: 'Create a managed wallet with POST /v1/agent/wallets and Suwappu provisions a server-side wallet signed via Turnkey — your agent sends a quote_id, never a private key. Set spending policies (per-key limits, allowed chains and pairs) so an autonomous agent can never move more than you allow. You can also bring your own keys and request an unsigned transaction instead.',
  },
  {
    q: 'Do I need an account?',
    a: 'No. POST /v1/agent/register with just a name and you get back an API key (suwappu_sk_...) immediately — no email, no approval queue, no human in the loop. That key authenticates every other call.',
  },
  {
    q: 'How do webhooks work?',
    a: 'Set a callback_url on your agent and Suwappu POSTs signed HTTP events as your swaps change state, instead of you polling GET /v1/agent/swap/status/:id. Each delivery is signed so you can verify it actually came from Suwappu.',
  },
];

export default function AgentsPage() {
  return (
    <main id="main-content" className="summer-page docs-shell">
      <Navigation />
      <div className="summer-shell mkt-page">
        {/* ── a. HERO ── */}
        <header className="mkt-hero mkt-hero--center agents-hero">
          <p className="summer-kicker">Built for AI agents</p>
          <h1>Onchain execution for AI agents.</h1>
          <p className="mkt-hero__lead">
            Quote, swap, and manage a portfolio across {stats.agentApiChains} chains from a REST API, an MCP
            server, or the A2A protocol — self-serve registration, no signup required, and
            pay only for the calls you make.
          </p>
          <div className="summer-actions summer-cta__actions">
            <a className="summer-button summer-button--primary" href="/docs/protocols/mcp">
              Connect MCP
            </a>
            <a className="summer-button summer-button--secondary" href="/docs/quick-start/overview">
              Get an API key
            </a>
          </div>
        </header>

        {/* ── b. CAPABILITIES ── */}
        <section className="agents-caps" aria-label="Capabilities">
          <h2 className="mkt-h2">Everything your agent needs to transact onchain.</h2>
          <div className="agents-caps__grid">
            {CAPABILITIES.map((cap) => (
              <article className="agents-cap" key={cap.title}>
                <h3>{cap.title}</h3>
                <p>{cap.body}</p>
              </article>
            ))}
          </div>
        </section>

        {/* ── c. GET STARTED IN MINUTES ── */}
        <section className="agent-steps" aria-label="Get started in minutes">
          <p className="summer-kicker">Get started in minutes</p>
          <h2 className="mkt-h2">Three calls from zero to a settled swap.</h2>

          <div className="agents-connect">
            <article className="agents-connect__item">
              <div className="agent-steps__num">1</div>
              <h2>Register an agent — no signup</h2>
              <p>
                POST your agent&apos;s name and get an API key back in the same response. No
                email, no approval queue, no human in the loop.
              </p>
              <div className="summer-code" aria-label="register.sh">
                <div className="summer-code__bar">
                  <span />
                  <span />
                  <span />
                  <b>register.sh</b>
                </div>
                <pre>
                  <code>{`curl -X POST https://api.suwappu.bot/v1/agent/register \\
  -H "Content-Type: application/json" \\
  -d '{"name": "my-agent"}'
# { "success": true, "api_key": "suwappu_sk_..." }`}</code>
                </pre>
              </div>
            </article>

            <article className="agents-connect__item">
              <div className="agent-steps__num">2</div>
              <h2>Add your key to MCP or an SDK</h2>
              <p>
                Drop the key into an MCP client config, or install the TypeScript or Python
                SDK and authenticate with a bearer token.
              </p>
              <AgentQuickstart />
            </article>

            <article className="agents-connect__item">
              <div className="agent-steps__num">3</div>
              <h2>Get a quote, then swap</h2>
              <p>
                Every swap is two calls: a quote, then an execute against your managed
                wallet — or request an unsigned transaction to sign yourself.
              </p>
              <div className="summer-code" aria-label="quote-and-swap.sh">
                <div className="summer-code__bar">
                  <span />
                  <span />
                  <span />
                  <b>quote-and-swap.sh</b>
                </div>
                <pre>
                  <code>{`curl -X POST https://api.suwappu.bot/v1/agent/quote \\
  -H "Authorization: Bearer suwappu_sk_YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"from_token":"USDC","to_token":"ETH","chain":"base","amount":"100"}'
# { "success": true, "quote_id": "q_abc123", ... }

curl -X POST https://api.suwappu.bot/v1/agent/swap/execute \\
  -H "Authorization: Bearer suwappu_sk_YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"quote_id": "q_abc123"}'`}</code>
                </pre>
              </div>
            </article>
          </div>
        </section>

        {/* ── d. INTEGRATION COMPARISON MATRIX ── */}
        <section className="compare" aria-labelledby="agents-matrix">
          <h2 id="agents-matrix" className="compare__title">
            Pick your surface. Same execution engine underneath.
          </h2>
          <div className="compare__scroll" role="region" aria-label="Integration comparison table" tabIndex={0}>
            <table className="compare-table">
              <caption className="sr-only">
                Capabilities available through the REST API, MCP server, A2A protocol, and SDKs.
              </caption>
              <thead>
                <tr>
                  <th scope="col" className="compare-table__rowhead">
                    Capability
                  </th>
                  {MATRIX_COLUMNS.map((c) => (
                    <th key={c.key} scope="col" className="compare-table__colhead">
                      <span className="compare-table__colname">{c.label}</span>
                      <span className="compare-table__colsub">{c.sub}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {MATRIX_ROWS.map((row) => (
                  <tr key={row.label}>
                    <th scope="row" className="compare-table__rowhead">
                      {row.label}
                    </th>
                    {MATRIX_COLUMNS.map((c) => {
                      const v = row.cells[c.key];
                      return (
                        <td key={c.key} className={`compare-cell compare-cell--${v}`}>
                          <span className="compare-cell__glyph" aria-hidden="true">
                            {CELL_GLYPH[v]}
                          </span>
                          <span className="sr-only">{CELL_WORD[v]}</span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="compare__legend">
            <span className="compare-legend__item">
              <span className="compare-cell__glyph compare-cell--yes" aria-hidden="true">✓</span> Available
            </span>
            <span className="compare-legend__item">
              <span className="compare-cell__glyph compare-cell--partial" aria-hidden="true">~</span> Partial
            </span>
            <span className="compare-legend__item">
              <span className="compare-cell__glyph compare-cell--no" aria-hidden="true">–</span> Not offered on this surface
            </span>
          </p>
          <p className="compare__note">
            Every surface shares the same auth, wallets, and execution engine — pick REST for full
            control, MCP to drop into an agent host, A2A for agent-to-agent messaging, or an SDK for
            typed calls in TypeScript or Python. Full endpoint list at{' '}
            <a href="/docs/api-reference/overview">/docs/api-reference</a> and{' '}
            <a href="https://api.suwappu.bot/v1/agent/openapi" target="_blank" rel="noopener noreferrer">
              the OpenAPI spec
            </a>
            .
          </p>
        </section>

        {/* ── e. AGENTIC PAYMENTS ── */}
        <section className="agents-caps" aria-label="Agentic payments">
          <p className="summer-kicker">Agentic payments</p>
          <h2 className="mkt-h2">Pay however your agent transacts.</h2>
          <div className="agents-caps__grid">
            {PAYMENT_MODES.map((p) => (
              <article className="agents-cap" key={p.title}>
                <h3>{p.title}</h3>
                <p>{p.body}</p>
              </article>
            ))}
          </div>
          <p className="agents-caption agent-payments__note">
            Full credit costs, rate limits, and fee rates by tier are on the{' '}
            <a href="/pricing#agent-api">Agent API pricing</a> section.
          </p>
        </section>

        {/* ── f. FAQ ── */}
        <section className="mkt-faq" aria-label="Frequently asked questions">
          <h2 className="mkt-h2">Agent API FAQ</h2>
          <FaqAccordion items={FAQS} />
        </section>

        {/* ── g. ENTERPRISE CTA BAND ── */}
        <section className="mkt-callout mkt-callout--enterprise" aria-label="Enterprise">
          <p className="mkt-callout__eyebrow">Enterprise</p>
          <p className="mkt-callout__body">
            Running an agent fleet or a trading desk at volume? Enterprise adds a 0.1% swap fee,
            multi-user org accounts with RBAC, scoped programmatic API keys, higher per-org rate
            limits, and a dedicated support SLA.
          </p>
          <a className="summer-button summer-button--secondary" href={ENTERPRISE_CONTACT_PATH}>
            Talk to Sales
          </a>
        </section>
      </div>
      <SummerFooter />
    </main>
  );
}
