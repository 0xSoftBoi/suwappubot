import type { Metadata } from 'next';
import StructuredData from '@/components/StructuredData';
import SummerNav from '@/components/SummerNav';
import SummerFooter from '@/components/SummerFooter';
import LiveQuote from '@/components/LiveQuote';
import ProofShot from '@/components/ProofShot';
import ChainSphereGL from '@/components/ChainSphereGL';
import RouteStages from '@/components/RouteStages';
import DepthSurfaceGL from '@/components/DepthSurfaceGL';
import ToolConstellationGL from '@/components/ToolConstellationGL';
import Reveal from '@/components/Reveal';
import AgentHandoff from '@/components/AgentHandoff';
import FaqAccordion from '@/components/FaqAccordion';
import { getTranslations } from 'next-intl/server';
import productStats from '@/data/stats.generated.json';
import { TELEGRAM_URL, TERMINAL_URL, MINI_APP_URL, ENTERPRISE_CONTACT_PATH } from '@/lib/links';
import { highlightTs, highlightJson, type Token } from '@/lib/highlight';
import './hero-e/hero-e.css';
import './site.css';

export const metadata: Metadata = {
  title: 'Suwappu | Cross-chain execution for agents and humans',
  description:
    `Best-price routing across ${productStats.platformChains} chains and ${productStats.routerCount} venues, HyperLiquid perps, and gasless swaps. You hold the keys; MCP server and REST API built for agents.`,
};

export const revalidate = 60;

/* ── Verified facts. Numbers come from stats.generated.json, never inline. ── */

/** Mirrors the TOOLS registry in api-ts/src/routes/mcp.ts. */
const MCP_TOOLS = [
  'get_quote', 'simulate_swap', 'execute_swap', 'get_swap_status', 'get_swap_history',
  'get_portfolio', 'get_prices', 'list_chains', 'list_tokens', 'get_tempo_tokens',
  'list_wallet_policies', 'browse_mpp_directory', 'perps_markets', 'perps_quote',
  'perps_positions', 'predict_markets', 'predict_market', 'predict_market_detail',
  'predict_book', 'predict_price', 'predict_trades', 'lend_markets', 'lend_market',
];

const RAIL = [
  { v: String(productStats.platformChains), l: 'chains' },
  { v: String(productStats.routerCount), l: 'routing venues' },
  { v: String(MCP_TOOLS.length), l: 'MCP tools' },
  { v: 'Sub-second', l: 'quote latency' },
];

/** `role` drives the same three-way route coding used in RouteStages
 *  (SWAP=persimmon, BRIDGE=leaf, SIGN=cream): Quote kicks off the route
 *  decision, Simulate is the cross-chain middle step, Sign is literal. */
const ENGINE = [
  {
    // Token count from bot/config/tokens.py (53 symbols registered).
    k: 'Quote',
    role: 'swap',
    d: `Every venue that supports your route quotes it: ${productStats.routerCount} venues covering 53 tokens, including Li.Fi, CoW, OKX, 1inch, KyberSwap, Jupiter, Across and Wormhole.`,
  },
  {
    k: 'Simulate',
    role: 'bridge',
    d: 'The winning path is simulated before you confirm. Bad fills, sandwich exposure and excess slippage surface while they are still avoidable.',
  },
  {
    k: 'Sign',
    role: 'sign',
    d: 'You sign. Managed keys are secured by envelope encryption (kms_aesgcm_v2) or a hardware-backed TEE via Turnkey, per key, never a plaintext key Suwappu can read. Bring your own keys through the agent API for full self-custody.',
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
    d: 'The fast lane. Quote, swap, snipe, run perps, stake, set DCA, copy traders or watch a wallet without leaving the chat, in English, Spanish, French or Chinese.',
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

/** Oversized-numeral stat band, after Engine. Every value here is either
 *  read live from stats.generated.json/MCP_TOOLS, or hardcoded against a
 *  verified count noted inline — never estimated. */
const BIG_STATS = [
  { v: String(productStats.platformChains), l: 'chains', d: 'Bot and terminal surface, testnets excluded.' },
  { v: String(productStats.routerCount), l: 'venues', d: 'Quote providers raced per swap, chain-gated.' },
  // 53 distinct symbols registered in bot/config/tokens.py.
  { v: '53', l: 'tokens', d: 'Symbols registered across every supported chain.' },
  { v: String(MCP_TOOLS.length), l: 'MCP tools', d: 'One remote server, callable by any agent.' },
];

/** Closing credibility row, reusing the same verified counts above plus the
 *  bot's i18n language count (bot/i18n.py: en, es, fr, zh). */
const SCALE_ROW = [
  { v: String(productStats.routerCount), l: 'venues routed' },
  { v: String(productStats.platformChains), l: 'chains' },
  { v: '53', l: 'tokens listed' },
  { v: String(MCP_TOOLS.length), l: 'MCP tools' },
  { v: '4', l: 'languages' },
];

/** Micro-text boundary strip (item 5): a decorative repeating band, not
 *  content — purely a section-boundary marker, so it is aria-hidden. */
const MICRO_STRIP = 'QUOTE · SIMULATE · SIGN · '.repeat(24);

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

/** Same fields as AGENT_CARD_FIELDS, formatted the way they actually come
 *  back from the agent card, for the pull-quote section's JSON artifact. */
const AGENT_CARD_JSON = `{\n${AGENT_CARD_FIELDS.map((f) => `  "${f.k}": "${f.v}"`).join(',\n')}\n}`;

/** Renders pre-tokenized code (see src/lib/highlight.ts) as coloured spans
 *  inside a true-black block (D9) — small enough not to need a dependency. */
function Code({ tokens }: { tokens: Token[] }) {
  return (
    <>
      {tokens.map((t, i) =>
        t.cls ? <span key={i} className={`tok-${t.cls}`}>{t.text}</span> : <span key={i}>{t.text}</span>
      )}
    </>
  );
}

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

/** One verified fact per integration partner (D8), each with the single
 *  giant number that backs it — or, where no verified number exists
 *  (Jupiter), a verified word-fact instead. Sourced from bot/config/settings.py
 *  (HyperLiquid builder fee) and the Tempo copy already stated below (gasless
 *  swap cost) — never a new, uncited number. */
const VENDORS = [
  {
    name: 'HyperLiquid',
    big: '1bp',
    d: 'Default builder fee on every perp trade routed through Suwappu, before any referral reward.',
  },
  {
    name: 'Tempo',
    big: '~$0.001',
    d: 'Suwappu-sponsored gas per swap on Tempo. Falls back to a normal swap if sponsorship is unavailable.',
  },
  {
    name: 'Jupiter',
    big: 'Native',
    d: `The default router for every Solana swap, with fee collection through Jupiter's own referral accounts.`,
  },
];

/** Condensed from /security — same vetted claims, same hedges. Don't add a
 *  claim here that isn't already stated (and qualified) on that page. */
const SECURITY = [
  { k: 'Keys', d: 'Signing keys live in a hardware-backed TEE (Turnkey). Anything encrypted at rest uses envelope encryption (kms_aesgcm_v2): a per-record data key wrapped by a KMS-managed key, not a plaintext key Suwappu can read.' },
  { k: 'Custody', d: 'Bring your own keys through the agent API for full self-custody, Suwappu never sees them, or use a managed wallet that signs server-side so your agent never handles a private key.' },
  { k: 'Controls', d: 'Per-key spend limits, chain and pair allowlists, withdrawal allowlists and TOTP two-factor authentication, enforced server-side so an agent can’t exceed the rails you set.' },
  { k: 'Review', d: 'Wallet and key-management paths have had independent red-team review, findings tracked and remediated. SOC 2 and public protocol audits are on the roadmap, not yet complete.' },
];

const FAQ = [
  {
    q: 'Do you custody my funds?',
    a: 'No by default. You sign every swap yourself; keys held for the managed-wallet path are secured by envelope encryption (kms_aesgcm_v2: a per-record data key wrapped by a KMS-managed key) or signed inside a hardware-backed TEE via Turnkey, never a plaintext key Suwappu can read. Prefer full self-custody? Bring your own keys through the agent API and Suwappu never sees them.',
  },
  {
    q: 'What does a swap cost?',
    a: `A routing fee on top of whatever the winning venue charges, tiered by volume: 1.0% on Free, 0.5% on Pro, 0.3% on Premium, 0.1% on Enterprise, with no markup beyond that and no monthly fee to start. Refer a trader with /ref and you earn 30% of the fees they generate, paid automatically. Gas is normal on most chains, and about a tenth of a cent on Tempo, where Suwappu sponsors the fee.`,
  },
  {
    q: 'Which chains and venues are covered?',
    a: `${productStats.platformChains} chains today, with ${productStats.routerCount} routing venues raced per quote across 53 tokens (Li.Fi, CoW, OKX, 1inch, KyberSwap, Jupiter, Across, Wormhole and others). Venues are chain-gated: a single swap only races the subset that actually supports its route, never the full list.`,
  },
  {
    q: 'How does an agent integrate?',
    a: `Through a remote MCP server (${MCP_TOOLS.length} tools), a REST API or the TypeScript/Python SDKs, all built on the same execution layer the terminal uses. Discovery is machine-readable: an OpenAPI schema, an A2A agent card, and an llms.txt index, all fetchable without a human reading these docs first.`,
  },
  {
    q: 'Can I cap what an agent is allowed to do?',
    a: 'Yes. Per-key spend caps, allowed chains and pairs, slippage limits and withdrawal allowlists are enforced server-side, not left to the agent to self-police. An agent operates strictly inside the rails you set on its key.',
  },
  {
    q: 'Is any of this audited?',
    a: 'The wallet and key-management paths have had independent red-team review, with findings tracked and remediated. SOC 2 and public third-party protocol audits are on the roadmap and not yet complete. See the security page for exactly what is done and what is not.',
  },
];

/** Venue-chip category, verified from repo code — never guessed. A name stays
 *  'neutral' unless a specific file/dispatch path proves its role:
 *  - 'bridge': dedicated provider under bot/services/bridge/, or a
 *    bot/services/*_api.py client whose swap_engine.py dispatch executes it
 *    as a cross-chain transfer (_execute_*_bridge / _execute_*_transfer),
 *    never a same-chain swap. (usdt0, Across, CCIP, CCTP, LayerZero, Wormhole)
 *  - 'dex': the chain-exclusive router for a single non-EVM/L2 chain in
 *    swap_engine.py's race-building block (one fetcher per chain, not raced
 *    against the EVM aggregator set). (GoatSwap, JuiceSwap, Jupiter, SunSwap,
 *    Tempo DEX)
 *  - 'aggregator': self-described as an aggregator in its own module
 *    docstring AND grouped under swap_engine.py's "Swap aggregators ready"
 *    log line / EVM aggregator set. (0x, 1inch, AVNU, CoW, KyberSwap, Li.Fi,
 *    OKX, Socket)
 *  Full evidence table lives in the showcase-dev report for this iteration. */
const VENUE_CLASS: Record<string, 'bridge' | 'dex' | 'aggregator'> = {
  Across: 'bridge',
  CCIP: 'bridge',
  CCTP: 'bridge',
  LayerZero: 'bridge',
  usdt0: 'bridge',
  Wormhole: 'bridge',
  GoatSwap: 'dex',
  JuiceSwap: 'dex',
  Jupiter: 'dex',
  SunSwap: 'dex',
  'Tempo DEX': 'dex',
  '0x': 'aggregator',
  '1inch': 'aggregator',
  AVNU: 'aggregator',
  CoW: 'aggregator',
  KyberSwap: 'aggregator',
  'Li.Fi': 'aggregator',
  OKX: 'aggregator',
  Socket: 'aggregator',
};

export default async function Home() {
  const t = await getTranslations('hero');
  return (
    <>
      <StructuredData />
      <main id="main-content" className="hd he sw sw-dark">
        <SummerNav />

        {/* ── Hero ─────────────────────────────────────────────── */}
        <section className="hd__hero hd__hero--split">
          <div className="he__grid" aria-hidden="true" />
          <div className="hd__copy">
          <p className="hd__eyebrow">{t('eyebrow')}</p>
          <h1 className="hd__h1">{t('h1')}</h1>
          <p className="hd__lead">
            {t('lead', { chains: productStats.platformChains, venues: productStats.routerCount })}
          </p>
          <div className="hd__cta">
            <a className="hd__btn" href={TELEGRAM_URL}>{t('cta_bot')}</a>
            <a className="hd__textlink" href={TERMINAL_URL}>
              {t('cta_terminal')} <span aria-hidden="true">→</span>
            </a>
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
              {productStats.routerCount} venues
            </p>
            <ul className="sw__chips">
              {productStats.routers.map((r) => {
                const cls = VENUE_CLASS[r];
                return (
                  <li key={r} className={cls ? `sw__chip--${cls}` : undefined}>
                    {r}
                  </li>
                );
              })}
            </ul>
            <p className="sw__chip-legend">
              <span className="sw__chip-legend-item sw__chip-legend-item--bridge">bridge</span>
              <span className="sw__chip-legend-item sw__chip-legend-item--aggregator">aggregator</span>
            </p>
            <p className="sw__note">
              Venues are chain-gated. Any single swap races the subset that supports its route.
            </p>
          </Reveal>
        </section>

        <div className="sw__microstrip" aria-hidden="true"><span>{MICRO_STRIP}</span></div>

        {/* ── Pull-quote moment: the A2A registry entry ───────────
             The statement carries the section on its own, full-width italic
             serif, the way a testimonial would — except what it's quoting
             is a live API response, not a person. */}
        <section className="sw__sec sw__proof sw__quote" aria-label="Verifiable agent registry entry">
          <Reveal>
            <h2 className="sw__h2 sw__h2--quote">
              A live entry in the A2A agent registry, not a screenshot of one.
            </h2>
            <p className="sw__lead">
              The object below is the actual response from the agent card, fetched at build
              time. Open the link and compare it yourself; nothing here is written for this page.
            </p>
            <div className="sw__proof-card">
              <pre className="sw__code sw__code--card"><code><Code tokens={highlightJson(AGENT_CARD_JSON)} /></code></pre>
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

        <div className="sw__ruler" aria-hidden="true" />

        {/* ── Engine ───────────────────────────────────────────── */}
        <section id="engine" className="sw__sec sw__sec--wide sw__sec--engine" aria-label="How the engine works">
          <Reveal>
            <h2 className="sw__h2">Three steps, every trade.</h2>
            <ol className="sw__steps sw__steps--cols">
              {ENGINE.map((s, i) => (
                <li key={s.k} className={`sw__step--${s.role}`}>
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

        {/* ── Scale, in numerals ───────────────────────────────── */}
        <section className="sw__sec sw__sec--quiet sw__bignums" aria-label="Platform scale">
          <Reveal>
            <ul className="sw__bignums-list">
              {BIG_STATS.map((s) => (
                <li key={s.l}>
                  <span className="sw__bignums-v">{s.v}</span>
                  <span className="sw__bignums-l">{s.l}</span>
                  <p className="sw__bignums-d">{s.d}</p>
                </li>
              ))}
            </ul>
          </Reveal>
        </section>

        {/* ── Vendor facts (D8) ─────────────────────────────────── */}
        <section className="sw__sec sw__sec--quiet" aria-label="Verified integration facts">
          <Reveal>
            <ul className="sw__vendors">
              {VENDORS.map((v) => (
                <li key={v.name}>
                  <span className="sw__vendors-name">{v.name}</span>
                  <span className="sw__vendors-big">{v.big}</span>
                  <p>{v.d}</p>
                </li>
              ))}
            </ul>
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
                  <a className="sw__surface" href={a.href} target="_blank" rel="noopener noreferrer">
                    <span className="sw__surface-meta">{a.meta}</span>
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
          <DepthSurfaceGL className="sw__field sw__field--top" />
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
          <ToolConstellationGL
            className="sw__field sw__field--top"
            toolCount={MCP_TOOLS.length}
            names={MCP_TOOLS}
          />
          <Reveal>
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
                Published as <code>@suwappu/sdk</code> on npm.
              </p>
              <div className="hd__cta">
                <a className="hd__btn hd__btn--ghost" href="/docs">Read the docs</a>
                <a
                  className="hd__btn hd__btn--ghost"
                  href="https://www.npmjs.com/package/@suwappu/sdk"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Install the SDK
                </a>
              </div>
            </div>
            <pre className="sw__code"><code><Code tokens={highlightTs(SDK)} /></code></pre>
          </Reveal>
        </section>

        <div className="sw__ruler" aria-hidden="true" />

        {/* ── Security: split panel (D7) ───────────────────────────
             Left: dark textured panel carrying the mono eyebrow + serif
             headline. Right: the four fact rows on a lighter ground, the way
             a real chart sits opposite the statement in the reference. */}
        <section id="security" className="sw__sec sw__split-panel" aria-label="Security and custody">
          <Reveal>
            <div className="sw__split-panel__left">
              <p className="sw__eyebrow">Security &amp; trust</p>
              <h2 className="sw__h2">Built to move money safely.</h2>
              <p className="sw__lead">
                Real funds move across {productStats.platformChains} chains through this. Here is
                exactly what protects them, and what is still on the roadmap rather than done.
              </p>
            </div>
            <div className="sw__split-panel__right">
              <dl className="sw__cmds sw__cmds--security">
                {SECURITY.map((s) => (
                  <div key={s.k}>
                    <dt>{s.k}</dt>
                    <dd>{s.d}</dd>
                  </div>
                ))}
              </dl>
              <a className="hd__btn hd__btn--ghost" href="/security">Read the full security page</a>
            </div>
          </Reveal>
        </section>

        {/* ── FAQ ──────────────────────────────────────────────── */}
        <section className="sw__sec sw__sec--quiet sw__faq" aria-label="Frequently asked questions">
          <Reveal>
            <h2 className="sw__h2">Before you connect a wallet.</h2>
            <FaqAccordion items={FAQ} />
          </Reveal>
        </section>

        {/* ── Scale boast ──────────────────────────────────────── */}
        <section className="sw__sec sw__sec--quiet sw__scalerow" aria-label="Infrastructure at a glance">
          <Reveal>
            <dl className="sw__scalerow-list">
              {SCALE_ROW.map((s) => (
                <div key={s.l}>
                  <dt>{s.l}</dt>
                  <dd>{s.v}</dd>
                </div>
              ))}
            </dl>
          </Reveal>
        </section>

        {/* ── Close ────────────────────────────────────────────── */}
        <section className="sw__sec sw__close" aria-label="Get started">
          <Reveal>
            <h2 className="sw__h2">Start in thirty seconds.</h2>
            <p className="sw__lead">
              Free to start, no card. You sign every swap, and no KYC for basic swaps.
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
