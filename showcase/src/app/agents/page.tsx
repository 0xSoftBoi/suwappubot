import type { Metadata } from 'next';
import Navigation from '@/components/Navigation';
import SummerFooter from '@/components/SummerFooter';
import FaqAccordion from '@/components/FaqAccordion';
import AgentQuickstart from './AgentQuickstart';
import { ENTERPRISE_CONTACT_PATH } from '@/lib/links';

export const metadata: Metadata = {
  title: 'Agents — Suwappu API, MCP & A2A for AI agents',
  description:
    'Onchain execution for AI agents: a REST API, an MCP server, and the A2A protocol for quotes, swaps, managed wallets, and portfolio across 15+ chains. Self-serve registration, pay-per-call with x402, no signup required.',
};

// ── Capability grid ──────────────────────────────────────────────
const CAPABILITIES = [
  {
    title: '15+ chains',
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

// ── Integration comparison matrix ────────────────────────────────
const MATRIX_COLUMNS: { key: string; label: string; sub: string }[] = [
  { key: 'rest', label: 'REST API', sub: '/v1/agent/*' },
  { key: 'mcp', label: 'MCP', sub: 'POST /mcp' },
  { key: 'a2a', label: 'A2A', sub: 'POST /a2a' },
  { key: 'sdk', label: 'SDKs', sub: 'TS · Python' },
];

type Cell = 'yes' | 'partial' | 'no';
const CELL_GLYPH: Record<Cell, string> = { yes: '✓', partial: '~', no: '–' };
const CELL_WORD: Record<Cell, string> = { yes: 'Yes', partial: 'Partial', no: 'No' };
const CELL_CLASS: Record<Cell, string> = {
  yes: 'text-[var(--accent)]',
  partial: 'text-[var(--ink-1)]',
  no: 'text-[var(--ink-1)]/50',
};

const MATRIX_ROWS: { label: string; cells: Record<string, Cell> }[] = [
  { label: 'Quotes', cells: { rest: 'yes', mcp: 'yes', a2a: 'yes', sdk: 'yes' } },
  { label: 'Swap execution', cells: { rest: 'yes', mcp: 'yes', a2a: 'yes', sdk: 'yes' } },
  { label: 'Portfolio & prices', cells: { rest: 'yes', mcp: 'yes', a2a: 'yes', sdk: 'yes' } },
  { label: 'Managed wallets & policies', cells: { rest: 'yes', mcp: 'no', a2a: 'no', sdk: 'yes' } },
  { label: 'Streaming / webhooks', cells: { rest: 'yes', mcp: 'no', a2a: 'partial', sdk: 'yes' } },
  { label: 'Self-registration (no signup)', cells: { rest: 'yes', mcp: 'no', a2a: 'no', sdk: 'yes' } },
  { label: 'Pay-per-call (x402)', cells: { rest: 'yes', mcp: 'no', a2a: 'no', sdk: 'no' } },
];

// ── Agentic payments ─────────────────────────────────────────────
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

// ── FAQ ───────────────────────────────────────────────────────────
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
    a: '15+ chains through one API, including EVM networks (Base, Ethereum, Arbitrum, Optimism, Polygon, BSC and more), Solana, TRON, and Tempo. Call GET /v1/agent/chains for the authoritative, current list rather than hardcoding it.',
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

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-card border border-white/10 bg-[var(--canvas-2)] p-6 ${className}`}>{children}</div>
  );
}

function CodeBlock({ file, code }: { file: string; code: string }) {
  return (
    <div className="overflow-hidden rounded-card border border-white/10 bg-[var(--canvas-2)]">
      <div className="flex items-center gap-1.5 border-b border-white/10 bg-[var(--canvas-1)] px-4 py-2.5">
        <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
        <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
        <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
        <b className="ml-2 font-mono text-xs font-normal text-[var(--ink-1)]">{file}</b>
      </div>
      <pre className="overflow-x-auto p-4">
        <code className="font-mono text-xs leading-relaxed text-[var(--ink-0)]">{code}</code>
      </pre>
    </div>
  );
}

export default function AgentsPage() {
  return (
    <main id="main-content" className="min-h-screen bg-[var(--canvas-0)] text-[var(--ink-0)]">
      <Navigation />
      <div className="mx-auto max-w-7xl px-6 pb-24">
        {/* ── HERO ── */}
        <header className="mx-auto max-w-2xl pt-16 pb-12 text-center md:pt-24">
          <p className="text-xs font-medium uppercase tracking-wide text-[var(--accent)]">Built for AI agents</p>
          <h1 className="mt-3 text-4xl font-medium tracking-tight md:text-5xl">
            Onchain execution for AI agents.
          </h1>
          <p className="mx-auto mt-5 max-w-lg text-base leading-relaxed text-[var(--ink-1)]">
            Quote, swap, and manage a portfolio across 15+ chains from a REST API, an MCP server, or
            the A2A protocol — self-serve registration, no signup required, pay only for the calls
            you make.
          </p>
          <div className="mt-7 flex flex-wrap justify-center gap-3">
            <a
              href="/docs/protocols/mcp"
              className="rounded-control bg-[var(--accent)] px-5 py-2.5 text-sm font-medium text-[#1a1108] transition-colors hover:bg-[var(--accent-hover)] active:scale-[0.98]"
            >
              Connect MCP
            </a>
            <a
              href="/docs/quick-start/overview"
              className="rounded-control border border-white/10 px-5 py-2.5 text-sm font-medium text-[var(--ink-0)] transition-colors hover:bg-white/5"
            >
              Get an API key
            </a>
          </div>
        </header>

        {/* ── CAPABILITIES ── */}
        <section aria-label="Capabilities">
          <h2 className="text-2xl font-medium tracking-tight">Everything your agent needs to transact onchain.</h2>
          <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {CAPABILITIES.map((cap) => (
              <Card key={cap.title}>
                <h3 className="text-base font-medium">{cap.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-[var(--ink-1)]">{cap.body}</p>
              </Card>
            ))}
          </div>
        </section>

        {/* ── GET STARTED IN MINUTES ── */}
        <section className="mt-20" aria-label="Get started in minutes">
          <p className="text-xs font-medium uppercase tracking-wide text-[var(--accent)]">Get started in minutes</p>
          <h2 className="mt-2 text-2xl font-medium tracking-tight">Three calls from zero to a settled swap.</h2>

          <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-3">
            <article>
              <div className="mb-3 flex h-8 w-8 items-center justify-center rounded-full border border-[var(--accent)]/40 font-mono text-sm text-[var(--accent)]">1</div>
              <h3 className="text-base font-medium">Register an agent — no signup</h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--ink-1)]">
                POST your agent&apos;s name and get an API key back in the same response. No email,
                no approval queue, no human in the loop.
              </p>
              <div className="mt-4">
                <CodeBlock
                  file="register.sh"
                  code={`curl -X POST https://api.suwappu.bot/v1/agent/register \\
  -H "Content-Type: application/json" \\
  -d '{"name": "my-agent"}'
# { "success": true, "api_key": "suwappu_sk_..." }`}
                />
              </div>
            </article>

            <article>
              <div className="mb-3 flex h-8 w-8 items-center justify-center rounded-full border border-[var(--accent)]/40 font-mono text-sm text-[var(--accent)]">2</div>
              <h3 className="text-base font-medium">Add your key to MCP or an SDK</h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--ink-1)]">
                Drop the key into an MCP client config, or install the TypeScript or Python SDK and
                authenticate with a bearer token.
              </p>
              <div className="mt-4">
                <AgentQuickstart />
              </div>
            </article>

            <article>
              <div className="mb-3 flex h-8 w-8 items-center justify-center rounded-full border border-[var(--accent)]/40 font-mono text-sm text-[var(--accent)]">3</div>
              <h3 className="text-base font-medium">Get a quote, then swap</h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--ink-1)]">
                Every swap is two calls: a quote, then an execute against your managed wallet — or
                request an unsigned transaction to sign yourself.
              </p>
              <div className="mt-4">
                <CodeBlock
                  file="quote-and-swap.sh"
                  code={`curl -X POST https://api.suwappu.bot/v1/agent/quote \\
  -H "Authorization: Bearer suwappu_sk_YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"from_token":"USDC","to_token":"ETH","chain":"base","amount":"100"}'
# { "success": true, "quote_id": "q_abc123", ... }

curl -X POST https://api.suwappu.bot/v1/agent/swap/execute \\
  -H "Authorization: Bearer suwappu_sk_YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"quote_id": "q_abc123"}'`}
                />
              </div>
            </article>
          </div>
        </section>

        {/* ── INTEGRATION COMPARISON MATRIX ── */}
        <section className="mt-20" aria-labelledby="agents-matrix">
          <h2 id="agents-matrix" className="text-2xl font-medium tracking-tight">
            Pick your surface. Same execution engine underneath.
          </h2>
          <div className="mt-6 overflow-x-auto rounded-card border border-white/10" role="region" aria-label="Integration comparison table" tabIndex={0}>
            <table className="w-full min-w-[560px] border-collapse text-sm">
              <caption className="sr-only">
                Capabilities available through the REST API, MCP server, A2A protocol, and SDKs.
              </caption>
              <thead>
                <tr className="border-b border-white/10 bg-[var(--canvas-2)]">
                  <th scope="col" className="px-4 py-3 text-left font-medium text-[var(--ink-1)]">Capability</th>
                  {MATRIX_COLUMNS.map((c) => (
                    <th key={c.key} scope="col" className="px-4 py-3 text-left font-medium">
                      <span className="block">{c.label}</span>
                      <span className="block font-mono text-xs font-normal text-[var(--ink-1)]">{c.sub}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {MATRIX_ROWS.map((row) => (
                  <tr key={row.label} className="border-b border-white/5 last:border-0">
                    <th scope="row" className="px-4 py-3 text-left font-normal text-[var(--ink-1)]">
                      {row.label}
                    </th>
                    {MATRIX_COLUMNS.map((c) => {
                      const v = row.cells[c.key];
                      return (
                        <td key={c.key} className={`px-4 py-3 text-center ${CELL_CLASS[v]}`}>
                          <span aria-hidden="true">{CELL_GLYPH[v]}</span>
                          <span className="sr-only">{CELL_WORD[v]}</span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-xs text-[var(--ink-1)]">
            <span><span className="text-[var(--accent)]">✓</span> Available</span>
            <span>~ Partial</span>
            <span>– Not offered on this surface</span>
          </p>
          <p className="mt-4 max-w-3xl text-sm leading-relaxed text-[var(--ink-1)]">
            Every surface shares the same auth, wallets, and execution engine — pick REST for full
            control, MCP to drop into an agent host, A2A for agent-to-agent messaging, or an SDK for
            typed calls in TypeScript or Python. Full endpoint list at{' '}
            <a href="/docs/api-reference/overview" className="text-[var(--accent)] hover:underline">/docs/api-reference</a> and{' '}
            <a href="https://api.suwappu.bot/v1/agent/openapi" target="_blank" rel="noopener noreferrer" className="text-[var(--accent)] hover:underline">
              the OpenAPI spec
            </a>
            .
          </p>
        </section>

        {/* ── AGENTIC PAYMENTS ── */}
        <section className="mt-20" aria-label="Agentic payments">
          <p className="text-xs font-medium uppercase tracking-wide text-[var(--accent)]">Agentic payments</p>
          <h2 className="mt-2 text-2xl font-medium tracking-tight">Pay however your agent transacts.</h2>
          <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
            {PAYMENT_MODES.map((p) => (
              <Card key={p.title}>
                <h3 className="text-base font-medium">{p.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-[var(--ink-1)]">{p.body}</p>
              </Card>
            ))}
          </div>
          <p className="mt-4 text-sm text-[var(--ink-1)]">
            Full credit costs, rate limits, and fee rates by tier are on the{' '}
            <a href="/pricing#agent-api" className="text-[var(--accent)] hover:underline">Agent API pricing</a> section.
          </p>
        </section>

        {/* ── FAQ ── */}
        <section className="mt-20" aria-label="Frequently asked questions">
          <h2 className="text-2xl font-medium tracking-tight">Agent API FAQ</h2>
          <div className="mt-6">
            <FaqAccordion items={FAQS} />
          </div>
        </section>

        {/* ── ENTERPRISE CTA BAND ── */}
        <section
          className="mt-20 flex flex-col items-start gap-4 rounded-panel border border-white/10 bg-[var(--canvas-1)] p-8 md:flex-row md:items-center md:justify-between"
          aria-label="Enterprise"
        >
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-[var(--accent)]">Enterprise</p>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--ink-1)]">
              Running an agent fleet or a trading desk at volume? Enterprise adds a 0.1% swap fee,
              multi-user org accounts with RBAC, scoped programmatic API keys, higher per-org rate
              limits, and a dedicated support SLA.
            </p>
          </div>
          <a
            href={ENTERPRISE_CONTACT_PATH}
            className="shrink-0 rounded-control border border-white/10 px-4 py-2.5 text-sm font-medium text-[var(--ink-0)] transition-colors hover:bg-white/5"
          >
            Talk to Sales
          </a>
        </section>
      </div>
      <SummerFooter />
    </main>
  );
}
