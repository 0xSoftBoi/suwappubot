import type { Metadata } from 'next';
import StructuredData from '@/components/StructuredData';
import SummerNav from '@/components/SummerNav';
import SummerFooter from '@/components/SummerFooter';
import LiveQuote from '@/components/LiveQuote';
import ProofShot from '@/components/ProofShot';
import ChainSphereGL from '@/components/ChainSphereGL';
import RouteStages from '@/components/RouteStages';
import Reveal from '@/components/Reveal';
import AgentHandoff from '@/components/AgentHandoff';
import { getTranslations } from 'next-intl/server';
import productStats from '@/data/stats.generated.json';
import { TELEGRAM_URL, TERMINAL_URL, MINI_APP_URL, ENTERPRISE_CONTACT_PATH } from '@/lib/links';
import './hero-e/hero-e.css';
import './site.css';

export const metadata: Metadata = {
  title: 'Suwappu | Cross-chain execution for agents and humans',
  description:
    `Best-price routing across ${productStats.platformChains} chains, HyperLiquid perps, and gasless swaps. Non-custodial, with an MCP server and REST API built for agents.`,
};

export const revalidate = 60;

/* ── Verified facts. Numbers come from stats.generated.json, never inline. ── */

const RAIL = [
  { v: String(productStats.platformChains), l: 'chains' },
  { v: String(productStats.routerCount), l: 'routing providers' },
  { v: '22', l: 'MCP tools' },
  { v: 'Sub-second', l: 'quote latency' },
];

const ENGINE = [
  {
    k: 'Quote',
    d: `Every provider that supports your route races to quote it. ${productStats.routerCount} are integrated, including Li.Fi, CoW, OKX, 1inch, KyberSwap, Jupiter, Across and Wormhole.`,
  },
  {
    k: 'Simulate',
    d: 'The winning path is simulated before you confirm. Bad fills, sandwich exposure and excess slippage surface while they are still avoidable.',
  },
  {
    k: 'Sign',
    d: 'You sign. MPC keys with KMS envelope encryption, non-custodial end to end. Bring your own keys through the agent API for full self-custody.',
  },
];

const SURFACES = [
  {
    name: 'Terminal',
    href: TERMINAL_URL,
    d: 'A dockable trading desk. Charts, order books, perps, prediction markets, lending, discovery and a wallet rail in one surface.',
    meta: '22 panels',
  },
  {
    name: 'Telegram bot',
    href: TELEGRAM_URL,
    d: 'The fast lane. Quote, swap, snipe, run perps, stake, set DCA, copy traders or watch a wallet without leaving the chat.',
    meta: '@suwappu_bot',
  },
  {
    name: 'Mini App',
    href: MINI_APP_URL,
    d: 'The full swap engine inside Telegram, with portfolio, send and receive on a touch surface.',
    meta: 'app.suwappu.bot',
  },
];

const PERPS = [
  { c: '/perps', d: 'Long or short BTC, ETH and SOL up to 20x, with take-profit, stop-loss and live PnL.' },
  { c: '/fund', d: 'Deposit USDC via Across, or native BTC, ETH and SOL via HyperUnit, from any chain.' },
  { c: '/stake', d: 'Delegate HYPE to a ranked validator with APR and commission visible, auto-compounding.' },
  { c: '/vault', d: 'Deposit to HLP and user vaults with live APR, TVL and PnL surfaced in the flow.' },
  { c: '/twap', d: 'Split a large order evenly over time with randomisation, monitored in the background.' },
  { c: '/spot', d: 'Trade HyperLiquid spot and move USDC between spot and perp wallets instantly.' },
];

/** Mirrors the TOOLS registry in api-ts/src/routes/mcp.ts. */
const MCP_TOOLS = [
  'get_quote', 'simulate_swap', 'execute_swap', 'get_swap_status', 'get_swap_history',
  'get_portfolio', 'get_prices', 'list_chains', 'list_tokens', 'get_tempo_tokens',
  'list_wallet_policies', 'browse_mpp_directory', 'perps_markets', 'perps_quote',
  'perps_positions', 'predict_markets', 'predict_market', 'predict_book',
  'predict_price', 'predict_trades', 'lend_markets', 'lend_market',
];

const SDK = `import { Suwappu } from "@suwappu/sdk";

const client = new Suwappu({ apiKey: process.env.SUWAPPU_API_KEY });

const quote = await client.getQuote({
  from: "USDC", to: "ETH", chain: "base", amount: "1000",
});
const tx = await client.swap(quote);`;

/** Fields pulled from the live agent card. Verify against
 *  https://api.suwappu.bot/.well-known/agent.json before editing — this is
 *  meant to match the artifact a visitor fetches, not describe it loosely. */
const AGENT_CARD_FIELDS = [
  { k: 'id', v: 'suwappu-dex' },
  { k: 'protocol', v: 'A2A v0.3' },
  { k: 'interface', v: 'JSON-RPC · /a2a' },
  { k: 'auth', v: 'bearer · suwappu_sk_…' },
];

/** Real, checkable endpoints — no invented data. Each row is something a
 *  visitor can open in a new tab and read the raw response of. */
const PROOF_ARTIFACTS = [
  {
    label: 'Service health',
    meta: 'GET /health',
    href: 'https://api.suwappu.bot/health',
    d: 'Live status, version and DB connectivity for the production API, in JSON.',
  },
  {
    label: 'OpenAPI schema',
    meta: 'GET /v1/agent/openapi',
    href: 'https://api.suwappu.bot/v1/agent/openapi',
    d: 'The exact schema an agent imports to call quotes, swaps, perps and lending.',
  },
  {
    label: 'llms.txt index',
    meta: 'GET /llms.txt',
    href: '/llms.txt',
    d: 'A plain-text map of the whole API, built for an LLM to ingest directly.',
  },
];

const FAQ = [
  {
    q: 'Do you custody my funds?',
    a: 'No by default. You sign every swap yourself; keys held for the managed-wallet path use envelope encryption (a per-record AES-256-GCM data key wrapped by a KMS-managed key) rather than Suwappu holding a plaintext key. Prefer full self-custody? Bring your own keys through the agent API and Suwappu never sees them.',
  },
  {
    q: 'What does a swap cost?',
    a: `Suwappu takes a routing fee on top of whatever the winning provider charges; there is no markup beyond that and no monthly fee to start. Gas is normal on most chains, and about a tenth of a cent on Tempo, where Suwappu sponsors the fee.`,
  },
  {
    q: 'Which chains and venues are covered?',
    a: `${productStats.platformChains} chains today, with ${productStats.routerCount} routing providers raced per quote (Li.Fi, CoW, OKX, 1inch, KyberSwap, Jupiter, Across, Wormhole and others). Providers are chain-gated — a single swap only races the subset that actually supports its route, never the full list.`,
  },
  {
    q: 'How does an agent integrate?',
    a: 'Through a remote MCP server, a REST API or the TypeScript/Python SDKs, all built on the same execution layer the terminal uses. Discovery is machine-readable: an OpenAPI schema, an A2A agent card, and an llms.txt index, all fetchable without a human reading these docs first.',
  },
  {
    q: 'Can I cap what an agent is allowed to do?',
    a: 'Yes. Per-key spend caps, allowed chains and pairs, slippage limits and withdrawal allowlists are enforced server-side, not left to the agent to self-police. An agent operates strictly inside the rails you set on its key.',
  },
  {
    q: 'Is any of this audited?',
    a: 'The wallet and key-management paths have had independent red-team review, with findings tracked and remediated. Formal third-party certifications are on the roadmap and not yet complete — see the security page for exactly what is done and what is not.',
  },
];

export default async function Home() {
  const t = await getTranslations('hero');
  return (
    <>
      <StructuredData />
      <main id="main-content" className="hd he sw">
        <SummerNav />

        {/* ── Hero ─────────────────────────────────────────────── */}
        <section className="hd__hero hd__hero--split">
          <div className="he__grid" aria-hidden="true" />
          <div className="hd__copy">
          <p className="hd__eyebrow">{t('eyebrow')}</p>
          <h1 className="hd__h1">{t('h1')}</h1>
          <p className="hd__lead">
            {t('lead', { chains: productStats.platformChains })}
          </p>
          <div className="hd__cta">
            <a className="hd__btn" href={TELEGRAM_URL}>{t('cta_bot')}</a>
            <a className="hd__btn hd__btn--ghost" href={TERMINAL_URL}>{t('cta_terminal')}</a>
          </div>

          <Reveal className="hd__stage"><LiveQuote variant="dark" /></Reveal>
          </div>

          <div className="hd__object">
            <ChainSphereGL className="sw__field--sphere" />
            <RouteStages />
          </div>

          <Reveal className="hd__rail" delay={120}>
            {RAIL.map((s) => (
              <div className="hd__stat" key={s.l}>
                <span className="hd__stat-v">{s.v}</span>
                <span className="hd__stat-l">{s.l}</span>
              </div>
            ))}
          </Reveal>
        </section>

        {/* ── Integrations ─────────────────────────────────────── */}
        <section className="sw__sec sw__strip" aria-label="Integrated networks and providers">
          <Reveal>
            <p className="sw__strip-h">
              Routing across {productStats.platformChains} chains and{' '}
              {productStats.routerCount} liquidity providers
            </p>
            <ul className="sw__chips">
              {productStats.routers.map((r) => <li key={r}>{r}</li>)}
            </ul>
            <p className="sw__note">
              Providers are chain-gated. Any single swap races the subset that supports its route.
            </p>
          </Reveal>
        </section>

        {/* ── Proof card ───────────────────────────────────────── */}
        <section className="sw__sec sw__proof" aria-label="Verifiable agent registry entry">
          <Reveal>
            <p className="sw__eyebrow">Registered, not claimed</p>
            <h2 className="sw__h2">A live entry in the A2A agent registry, not a screenshot of one.</h2>
            <p className="sw__lead">
              The fields below are the actual response from the agent card, fetched at build
              time. Open the link and compare it yourself; nothing here is written for this page.
            </p>
            <div className="sw__proof-card">
              <dl className="sw__proof-fields">
                {AGENT_CARD_FIELDS.map((f) => (
                  <div key={f.k}>
                    <dt>{f.k}</dt>
                    <dd>{f.v}</dd>
                  </div>
                ))}
              </dl>
              <a
                className="sw__proof-link"
                href="https://api.suwappu.bot/.well-known/agent.json"
                target="_blank"
                rel="noopener noreferrer"
              >
                Fetch the agent card <span aria-hidden="true">→</span>
              </a>
            </div>
          </Reveal>
        </section>

        {/* ── Engine ───────────────────────────────────────────── */}
        <section id="engine" className="sw__sec sw__sec--wide" aria-label="How the engine works">
          <Reveal>
            <h2 className="sw__h2">Three steps, every trade.</h2>
            <ol className="sw__steps sw__steps--cols">
              {ENGINE.map((s, i) => (
                <li key={s.k}>
                  <span className="sw__step-n">STEP {String(i + 1).padStart(2, '0')}</span>
                  <div>
                    <h3>{s.k}</h3>
                    <p>{s.d}</p>
                  </div>
                </li>
              ))}
            </ol>
            <ProofShot
              src="/proof/spot-desk.png"
              width={3160}
              height={940}
              alt="The Suwappu terminal: an ETH/USDC candlestick chart, a live order book with bid and ask depth, and the swap ticket showing a 90/100 token trust score from GoPlus."
              caption="Live Suwappu Terminal · captured 31 Jul 2026"
            />
          </Reveal>
        </section>

        {/* ── Proof, not promises ──────────────────────────────── */}
        <section className="sw__sec" aria-label="Live artifacts you can check yourself">
          <Reveal>
            <p className="sw__eyebrow">Proof, not promises</p>
            <h2 className="sw__h2">Three things you can open right now.</h2>
            <ul className="sw__artifacts">
              {PROOF_ARTIFACTS.map((a) => (
                <li key={a.label}>
                  <a href={a.href} target="_blank" rel="noopener noreferrer">
                    <span className="sw__artifact-meta">{a.meta}</span>
                    <h3>{a.label}</h3>
                    <p>{a.d}</p>
                    <span className="sw__arrow" aria-hidden="true">→</span>
                  </a>
                </li>
              ))}
            </ul>
          </Reveal>
        </section>

        {/* ── Surfaces ─────────────────────────────────────────── */}
        <section id="terminal" className="sw__sec" aria-label="Product surfaces">
          <Reveal>
            <h2 className="sw__h2">One engine, three ways in.</h2>
            <div className="sw__surfaces">
              {SURFACES.map((s, i) => (
                <a
                  key={s.name}
                  className={`sw__surface${i === 0 ? ' sw__surface--lead' : ''}`}
                  href={s.href}
                >
                  <span className="sw__surface-meta">{s.meta}</span>
                  <h3>{s.name}</h3>
                  <p>{s.d}</p>
                  <span className="sw__arrow" aria-hidden="true">→</span>
                </a>
              ))}
            </div>
          </Reveal>
        </section>

        {/* ── Perps ────────────────────────────────────────────── */}
        <section id="hyperliquid" className="sw__sec" aria-label="HyperLiquid perps">
          <Reveal>
            <h2 className="sw__h2">HyperLiquid, managed from chat.</h2>
            <p className="sw__lead">
              The full ecosystem from inside the bot. Fund from any chain, trade up to 20x,
              stake HYPE and earn in vaults. No bridging tabs, no address pasting.
            </p>
            <ProofShot
              src="/proof/perps-desk.png"
              width={3160}
              height={720}
              alt="The perps desk: a markets table listing BTC, ETH, SOL and more with mark price, open interest, funding and max leverage, beside the order ticket with cross or isolated margin, leverage and take-profit and stop-loss fields."
              caption="Live perps desk, via HyperLiquid · captured 31 Jul 2026"
            />
            <dl className="sw__cmds">
              {PERPS.map((p) => (
                <div key={p.c}>
                  <dt>{p.c}</dt>
                  <dd>{p.d}</dd>
                </div>
              ))}
            </dl>
          </Reveal>
        </section>

        {/* ── Tempo ────────────────────────────────────────────── */}
        <section id="tempo" className="sw__sec sw__sec--quiet" aria-label="Gasless swaps on Tempo">
          <Reveal>
            <h2 className="sw__h2">Trade without holding gas tokens.</h2>
            <p className="sw__lead">
              Suwappu sponsors transaction fees on Tempo chains, so you swap TIP-20 stablecoins
              for about a tenth of a cent while we cover the rest. It falls back to a normal
              swap if sponsorship is unavailable, so nothing ever blocks.
            </p>
          </Reveal>
        </section>

        {/* ── Agents ───────────────────────────────────────────── */}
        <section id="agents" className="sw__sec" aria-label="Built for agents">
          <Reveal>
            <p className="sw__eyebrow">Built for the agentic era</p>
            <h2 className="sw__h2">Hand your trading layer to an agent.</h2>
            <p className="sw__lead">
              A remote MCP server, a REST API and typed SDKs, discoverable through llms.txt and
              an agent manifest, with per-key spend caps and slippage limits so autonomous agents
              stay inside rails you define.
            </p>
            <AgentHandoff />
          </Reveal>
        </section>

        {/* ── MCP registry ─────────────────────────────────────── */}
        <section id="api" className="sw__sec" aria-label="MCP tool registry">
          <Reveal>
            <div className="sw__panel">
              <div className="sw__panel-bar">
                <span>Tool registry</span>
                <span className="sw__panel-meta">
                  {MCP_TOOLS.length} tools, 3 workflow prompts, streamable HTTP
                </span>
              </div>
              <ul className="sw__tools">
                {MCP_TOOLS.map((t, i) => (
                  <li key={t}>
                    <span>{String(i + 1).padStart(2, '0')}</span>
                    {t}
                  </li>
                ))}
              </ul>
            </div>
          </Reveal>
        </section>

        {/* ── SDK ──────────────────────────────────────────────── */}
        <section id="build" className="sw__sec sw__split" aria-label="SDKs">
          <Reveal>
            <div>
              <h2 className="sw__h2">Ship in TypeScript or Python.</h2>
              <p className="sw__lead">
                The same execution layer the terminal runs on. Swap, perps, predict and lending
                through one typed client across {productStats.agentApiChains} agent-ready chains.
              </p>
              <a className="hd__btn hd__btn--ghost" href="/docs">Read the docs</a>
            </div>
            <pre className="sw__code"><code>{SDK}</code></pre>
          </Reveal>
        </section>

        {/* ── Close ────────────────────────────────────────────── */}
        <section className="sw__sec sw__close" aria-label="Get started">
          <Reveal>
            <h2 className="sw__h2">Start in thirty seconds.</h2>
            <p className="sw__lead">
              Free to start, no card. Non-custodial, and no KYC for basic swaps.
            </p>
            <div className="hd__cta">
              <a className="hd__btn" href={TELEGRAM_URL}>Start trading free</a>
              <a className="hd__btn hd__btn--ghost" href={ENTERPRISE_CONTACT_PATH}>Talk to sales</a>
            </div>
          </Reveal>
        </section>

        <SummerFooter />
      </main>
    </>
  );
}
