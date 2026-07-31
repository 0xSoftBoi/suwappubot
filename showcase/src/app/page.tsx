import type { Metadata } from 'next';
import StructuredData from '@/components/StructuredData';
import SummerNav from '@/components/SummerNav';
import SummerFooter from '@/components/SummerFooter';
import LiveQuote from '@/components/LiveQuote';
import SectionField from '@/components/SectionField';
import RouteStages from '@/components/RouteStages';
import Reveal from '@/components/Reveal';
import AgentHandoff from '@/components/AgentHandoff';
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

export default function Home() {
  return (
    <>
      <StructuredData />
      <main id="main-content" className="hd he sw">
        <SummerNav />

        {/* ── Hero ─────────────────────────────────────────────── */}
        <section className="hd__hero hd__hero--split">
          <div className="he__grid" aria-hidden="true" />
          <div className="hd__copy">
          <p className="hd__eyebrow">Cross-chain execution</p>
          <h1 className="hd__h1">The best price, proven every trade.</h1>
          <p className="hd__lead">
            Every provider that supports your route competes for the order, across{' '}
            {productStats.platformChains} chains. You hold the keys the whole way.
          </p>
          <div className="hd__cta">
            <a className="hd__btn" href={TELEGRAM_URL}>Start trading free</a>
            <a className="hd__btn hd__btn--ghost" href={TERMINAL_URL}>Open Terminal</a>
          </div>

          <Reveal className="hd__stage"><LiveQuote variant="dark" /></Reveal>
          </div>

          <div className="hd__object">
            <SectionField motif="chains" className="sw__field--sphere" />
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

        {/* ── Engine ───────────────────────────────────────────── */}
        <section id="engine" className="sw__sec" aria-label="How the engine works">
          <SectionField motif="race" className="sw__field" />
          <Reveal>
            <h2 className="sw__h2">Three steps, every trade.</h2>
            <ol className="sw__steps">
              {ENGINE.map((s, i) => (
                <li key={s.k}>
                  <span className="sw__step-n">{String(i + 1).padStart(2, '0')}</span>
                  <div>
                    <h3>{s.k}</h3>
                    <p>{s.d}</p>
                  </div>
                </li>
              ))}
            </ol>
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
          <SectionField motif="markets" className="sw__field sw__field--top" />
          <Reveal>
            <h2 className="sw__h2">HyperLiquid, managed from chat.</h2>
            <p className="sw__lead">
              The full ecosystem from inside the bot. Fund from any chain, trade up to 20x,
              stake HYPE and earn in vaults. No bridging tabs, no address pasting.
            </p>
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
        <section id="tempo" className="sw__sec sw__split" aria-label="Gasless swaps on Tempo">
          <Reveal>
            <div>
              <h2 className="sw__h2">Trade without holding gas tokens.</h2>
              <p className="sw__lead">
                Suwappu sponsors transaction fees on Tempo chains, so you swap TIP-20 stablecoins
                for about a tenth of a cent while we cover the rest. It falls back to a normal
                swap if sponsorship is unavailable, so nothing ever blocks.
              </p>
            </div>
            <div className="sw__figure">
              <SectionField motif="sponsor" className="sw__figure-canvas" />
            </div>
          </Reveal>
        </section>

        {/* ── Agents ───────────────────────────────────────────── */}
        <section id="agents" className="sw__sec" aria-label="Built for agents">
          <SectionField motif="tools" className="sw__field sw__field--top" />
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
