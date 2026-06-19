import Analytics from '@/components/Analytics';
import StructuredData from '@/components/StructuredData';
import LiveTerminal from '@/components/LiveTerminal';
import SummerFooter from '@/components/SummerFooter';
import CosmicAtmosphere from '@/components/CosmicAtmosphere';
import { TELEGRAM_URL, WHATSAPP_URL, WHATSAPP_ENABLED } from '@/lib/links';

const TERMINAL_URL = 'https://terminal.suwappu.bot';

const stats = [
  { value: '40+', label: 'Chains' },
  { value: '9', label: 'Routers' },
  { value: '20x', label: 'Perps leverage' },
  { value: '$0.001', label: 'Gasless on Tempo' },
];

const engineFeatures = [
  {
    mark: 'fruit',
    title: 'Cross-chain by default',
    description:
      'Ethereum, Base, Arbitrum, Solana, Polygon, BSC, Avalanche, Starknet, Bitcoin L2s and 30+ more — one engine routes across all of them.',
  },
  {
    mark: 'sun',
    title: 'Best-price routing',
    description:
      'Every swap races LiFi, CoW, OKX, 1inch and KyberSwap (plus Jupiter on Solana). You get the best quote, not the first one.',
  },
  {
    mark: 'soft',
    title: 'Secure key management',
    description:
      'Keys encrypted with KMS envelope encryption and signed server-side — or bring your own keys via the agent API for full self-custody.',
  },
  {
    mark: 'mist',
    title: 'Everywhere you work',
    description:
      'Telegram bot, WhatsApp bot, trading terminal, TypeScript SDK, MCP server, and REST API. Pick the interface that fits.',
  },
];

const modules = [
  {
    eyebrow: 'Live workspace',
    title: 'Terminal',
    body: 'Charts, market tables, order books, swap tickets, perps, wallet rail, and execution controls in one dense trading surface.',
    stat: 'Full desk',
  },
  {
    eyebrow: 'Execution layer',
    title: 'Agent API',
    body: 'Quotes, swaps, status checks, perps, prediction markets, lending, and managed wallet actions through one API.',
    stat: '40+ chains',
  },
  {
    eyebrow: 'Fast command lane',
    title: 'Telegram bot',
    body: 'Quote, swap, snipe, run perps, stake, set DCA, copy traders, or watch a wallet — all without leaving the chat.',
    stat: '@suwappu_bot',
  },
];

// HyperLiquid hub cards — perps, funding, staking, vaults, TWAP, spot.
const hyperliquid = [
  {
    cmd: '/perps',
    title: 'Perpetuals',
    body: 'Long or short BTC, ETH, SOL and more up to 20x. Take-profit, stop-loss, and live PnL with one-tap close.',
  },
  {
    cmd: '/fund',
    title: 'One-click funding',
    body: 'Deposit USDC via Across or native BTC/ETH/SOL via HyperUnit into your HyperCore account from any chain.',
  },
  {
    cmd: '/stake',
    title: 'HYPE staking',
    body: 'Delegate to a ranked validator picker — APR and commission visible — with auto-compounding. No address pasting.',
  },
  {
    cmd: '/vault',
    title: 'Vaults',
    body: 'Deposit to HLP and user vaults with live APR, TVL, and PnL surfaced right in the flow.',
  },
  {
    cmd: '/twap',
    title: 'TWAP orders',
    body: 'Split a large order evenly over time with randomization — persisted and monitored in the background.',
  },
  {
    cmd: '/spot',
    title: 'Spot + transfers',
    body: 'Trade HyperLiquid spot and move USDC between spot and perp wallets instantly with /hlmove.',
  },
];

// "Works with" — chains and routers Suwappu routes across (borrowed-legitimacy strip).
const trustChains = [
  'Ethereum', 'Base', 'Arbitrum', 'Optimism', 'Solana', 'Polygon',
  'BSC', 'Avalanche', 'Starknet', 'HyperLiquid', 'Tempo',
];
const trustRouters = ['LiFi', 'CoW', 'OKX', '1inch', 'KyberSwap', 'Jupiter', 'Across', 'CCTP'];

// Agent / MCP credibility cards.
const agentCards = [
  {
    tag: 'MCP server',
    title: 'Drop into any MCP client',
    body: 'Quotes, swaps, perps, and portfolio as agent-callable tools in Claude, Cursor, or any MCP host.',
  },
  {
    tag: 'SDK + REST',
    title: 'Same surface, in code',
    body: '`bun add @suwappu/sdk` or call the REST API directly — the exact execution layer the terminal runs on.',
  },
  {
    tag: 'Discoverable',
    title: 'llms.txt + agent.json',
    body: 'Machine-readable docs and an agent manifest so an LLM can find every action without hand-holding.',
  },
  {
    tag: 'Guardrails',
    title: 'You set the limits',
    body: 'Per-key slippage caps, spend limits, allowed chains and pairs, plus 2FA. Agents act inside your rails.',
  },
];

const sdkLines = [
  'bun add @suwappu/sdk',
  "suwappu quote ETH USDC 1.0 --chain base",
  'route: Base -> Uniswap V3',
  'out: 3,483.28 USDC',
  'suwappu perps long BTC --size 0.1 --lev 5x',
  'status: filled',
];

const rows = [
  ['ETH/USDC', '$3,483.28', '+6.94%', 'Uniswap V3'],
  ['BTC-PERP', '$64,180', '+1.42%', 'HyperLiquid'],
  ['SOL/USDC', '$182.34', '+2.14%', 'Jupiter'],
  ['pathUSD', '$1.00', 'gasless', 'Tempo'],
];

function Hero() {
  return (
    <section className="summer-hero">
      <div className="summer-flower-field summer-flower-field--hero" aria-hidden="true">
        <span className="summer-flower summer-flower--soft" />
        <span className="summer-flower summer-flower--sun" />
        <span className="summer-flower summer-flower--mist" />
        <span className="summer-petal summer-petal--sky" />
        <span className="summer-petal summer-petal--blush" />
      </div>
      <img className="summer-hero__fruit" src="/logo.svg" alt="" aria-hidden="true" />
      <div className="summer-hero__copy">
        <p className="summer-kicker">suwappu · cross-chain execution</p>
        <h1 className="summer-hero__h1">
          Cross-chain swaps,<br />
          HyperLiquid perps,<br />
          and <span className="summer-hero__accent">gasless</span> trades.
        </h1>
        <p className="summer-hero__lead">
          One bot does all of it — best-price routing across 40+ chains, perps up to
          20x, and sponsored-gas swaps. From Telegram, a terminal, or one SDK call.
        </p>
        <div className="summer-actions">
          <a
            className="summer-button summer-button--primary"
            href={TELEGRAM_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open Telegram Bot
          </a>
          <a className="summer-button summer-button--secondary" href={TERMINAL_URL}>
            Open Terminal
          </a>
          <a className="summer-button summer-button--secondary" href="/docs">
            Docs/API
          </a>
        </div>
        <div className="summer-install">
          <span>$</span>
          <code>bun add @suwappu/sdk</code>
        </div>
      </div>
      <LiveTerminal />
    </section>
  );
}

export default function Home() {
  return (
    <>
      <StructuredData />
      <Analytics />
      <main id="main-content" className="summer-page summer-page--cosmic">
        <CosmicAtmosphere />
        <div className="summer-bg summer-bg--stem" aria-hidden="true" />
        <div className="summer-bg summer-bg--bloom" aria-hidden="true" />
        <div className="summer-mobile-rail" aria-hidden="true">
          <img src="/logo.svg" alt="" aria-hidden="true" />
          <span className="summer-flower summer-flower--soft" />
          <b>すわっぷ</b>
          <span className="summer-rail-loop summer-rail-loop--top" />
          <span className="summer-rail-loop summer-rail-loop--bottom" />
          <span className="summer-flower summer-flower--sun" />
        </div>

        <header className="summer-nav">
          <a className="summer-brand" href="/">
            <img src="/logo.svg" alt="" aria-hidden="true" />
            <span>suwappu</span>
          </a>
          <nav aria-label="Primary navigation">
            <a href="#engine">Engine</a>
            <a href="#hyperliquid">HyperLiquid</a>
            <a href="#tempo">Tempo</a>
            <a href="#agents">Agents</a>
            <a href="#api">API</a>
            <a href="/pricing">Pricing</a>
            <a href="/docs">Docs</a>
          </nav>
          <a className="summer-nav__cta" href={TELEGRAM_URL} target="_blank" rel="noopener noreferrer">
            Open Bot
          </a>
          <a className="summer-nav__cta summer-nav__cta--ghost" href={TERMINAL_URL}>
            Open Terminal
          </a>
        </header>

        <div className="summer-shell">
          <Hero />

          {/* ── STATS STRIP ── */}
          <section className="summer-stats" aria-label="At a glance">
            {stats.map((s) => (
              <div className="summer-stat" key={s.label}>
                <strong>{s.value}</strong>
                <span>{s.label}</span>
              </div>
            ))}
          </section>

          {/* ── WORKS WITH ── */}
          <section className="summer-trust" aria-label="Works with">
            <p className="summer-trust__label">Routes across every major chain &amp; aggregator</p>
            <div className="summer-trust__rows">
              <div className="summer-trust__group">
                <span>Chains</span>
                <div className="summer-trust__chips">
                  {trustChains.map((c) => (
                    <b key={c}>{c}</b>
                  ))}
                  <b>+30 more</b>
                </div>
              </div>
              <div className="summer-trust__group">
                <span>Routers</span>
                <div className="summer-trust__chips">
                  {trustRouters.map((r) => (
                    <b key={r}>{r}</b>
                  ))}
                </div>
              </div>
            </div>
            <div className="summer-verify">
              <span>Don&apos;t trust, verify</span>
              <a href="/status">Live status</a>
              <a href="https://github.com/0xSoftBoi/suwappubot" target="_blank" rel="noopener noreferrer">GitHub</a>
              <a href="/docs/api-reference/overview">OpenAPI spec</a>
              <a href="/llms.txt" target="_blank" rel="noopener noreferrer">llms.txt</a>
            </div>
          </section>

          {/* ── CROSS-CHAIN ENGINE ── */}
          <section id="engine" className="summer-features" aria-label="Cross-chain engine">
            <div className="summer-features__head">
              <p className="summer-kicker">The engine</p>
              <h2>One router for every chain.</h2>
            </div>
            <div className="summer-features__grid">
              {engineFeatures.map((feature) => (
                <article className="summer-feature" key={feature.title}>
                  <span
                    className={
                      feature.mark === 'fruit'
                        ? 'summer-feature__mark summer-feature__mark--fruit'
                        : `summer-feature__mark summer-flower summer-flower--${feature.mark}`
                    }
                    aria-hidden="true"
                  />
                  <h3>{feature.title}</h3>
                  <p>{feature.description}</p>
                </article>
              ))}
            </div>
          </section>

          {/* ── PRODUCT MODULES ── */}
          <section id="terminal" className="summer-modules" aria-label="Product modules">
            {modules.map((module, index) => (
              <article className="summer-module" key={module.title}>
                <i
                  className={
                    index === 0
                      ? 'summer-module__mark summer-module__mark--fruit'
                      : `summer-module__mark summer-flower ${index === 1 ? 'summer-flower--soft' : 'summer-flower--sun'}`
                  }
                  aria-hidden="true"
                />
                <p>{module.eyebrow}</p>
                <h2>{module.title}</h2>
                <span>{module.stat}</span>
                <div>{module.body}</div>
              </article>
            ))}
          </section>

          {/* ── HYPERLIQUID HUB ── */}
          <section id="hyperliquid" className="summer-hub" aria-label="HyperLiquid hub">
            <div className="summer-flower summer-flower--sun summer-hub__flower" aria-hidden="true" />
            <div className="summer-hub__head">
              <div>
                <p className="summer-kicker">HyperLiquid, built in</p>
                <h2>Perps, funding, staking, vaults.</h2>
              </div>
              <p>
                The full HyperLiquid ecosystem from inside the bot — fund your
                HyperCore account from any chain, trade perps up to 20x, stake HYPE,
                and earn in vaults. No bridging tabs, no address pasting.
              </p>
            </div>
            <div className="summer-hub__grid">
              {hyperliquid.map((card) => (
                <article className="summer-hub__card" key={card.cmd}>
                  <code className="summer-hub__cmd">{card.cmd}</code>
                  <h3>{card.title}</h3>
                  <p>{card.body}</p>
                </article>
              ))}
            </div>
          </section>

          {/* ── TEMPO GASLESS RAIL ── */}
          <section id="tempo" className="summer-tempo" aria-label="Tempo gasless">
            <div className="summer-flower summer-flower--mist summer-tempo__flower" aria-hidden="true" />
            <div className="summer-tempo__copy">
              <p className="summer-kicker">Tempo, first-class</p>
              <h2>Your first swaps are on us.</h2>
              <p>
                Suwappu sponsors gas for new users with Tempo fee-payer transactions —
                you trade TIP-20 stablecoins for about a tenth of a cent while we cover
                the rest. Falls back to a normal swap if sponsorship is unavailable, so
                nothing ever blocks.
              </p>
              <div className="summer-tempo__tags">
                <span>Type 0x76 fee-payer</span>
                <span>~$0.001 per swap</span>
                <span>Machine Payments (/mpp)</span>
              </div>
            </div>
            <div className="summer-tempo__rail" aria-hidden="true">
              <div className="summer-tempo__step">
                <strong>You swap</strong>
                <span>100 USDC → pathUSD</span>
              </div>
              <div className="summer-tempo__arrow">↓</div>
              <div className="summer-tempo__step">
                <strong>We sponsor gas</strong>
                <span>fee-payer counter-signs 0x76</span>
              </div>
              <div className="summer-tempo__arrow">↓</div>
              <div className="summer-tempo__step summer-tempo__step--ok">
                <strong>Settled on Tempo</strong>
                <span>you paid $0.001</span>
              </div>
            </div>
          </section>

          {/* ── AGENT API + SDK ── */}
          <section id="api" className="summer-sdk">
            <div className="summer-flower summer-flower--mist summer-sdk__flower" aria-hidden="true" />
            <div>
              <p className="summer-kicker">Agent API &amp; SDK</p>
              <h2>Quote, swap, trade — in code.</h2>
              <p>
                The same execution surface the terminal uses, exposed as an SDK, MCP
                server, and REST API. Swaps, perps, prediction markets, and lending
                from a handful of calls.
              </p>
              <div className="summer-flow">
                {['Register an agent', 'Request a quote', 'Execute the route', 'Open a perp'].map((step, index) => (
                  <div key={step}>
                    <span>0{index + 1}</span>
                    <strong>{step}</strong>
                  </div>
                ))}
              </div>
            </div>
            <div className="summer-code" aria-label="SDK example">
              <div className="summer-code__bar">
                <span />
                <span />
                <span />
                <b>@suwappu/sdk</b>
              </div>
              <pre>
                {sdkLines.map((line, index) => (
                  <code key={line} className={index === 3 || index === 5 ? 'is-success' : ''}>
                    <span>{index === 2 || index === 3 || index === 5 ? '=' : '>'}</span>
                    {line}
                  </code>
                ))}
              </pre>
            </div>
          </section>

          {/* ── BUILT FOR AI AGENTS ── */}
          <section id="agents" className="summer-agents" aria-label="Built for AI agents">
            <div className="summer-flower summer-flower--soft summer-agents__flower" aria-hidden="true" />
            <div className="summer-agents__head">
              <p className="summer-kicker">Built for AI agents</p>
              <h2>Let an agent execute. You set the limits.</h2>
              <p>
                Suwappu exposes the same execution surface as an MCP server, a
                TypeScript SDK, and a REST API — discoverable through llms.txt and an
                agent manifest, with policy guardrails so autonomous swaps stay inside
                the rails you define.
              </p>
            </div>
            <div className="summer-agents__grid">
              {agentCards.map((card) => (
                <article className="summer-agents__card" key={card.tag}>
                  <b>{card.tag}</b>
                  <h3>{card.title}</h3>
                  <p>{card.body}</p>
                </article>
              ))}
            </div>
          </section>

          {/* ── MARKET PROOF ── */}
          <section id="bot" className="summer-proof">
            <div className="summer-flower summer-flower--soft summer-proof__flower" aria-hidden="true" />
            <div className="summer-proof__head">
              <div>
                <p className="summer-kicker">Market proof</p>
                <h2>Spot, perps, and gasless — side by side.</h2>
              </div>
              <p>
                Market rows, route health, perps, and gasless Tempo pairs stay visible
                without making the page feel crowded.
              </p>
            </div>
            <div className="summer-table">
              <div className="summer-table__row summer-table__row--head">
                <span>Pair</span>
                <span>Price</span>
                <span>24h</span>
                <span>Route</span>
              </div>
              {rows.map((row) => (
                <div className="summer-table__row" key={row[0]}>
                  <span>{row[0]}</span>
                  <span>{row[1]}</span>
                  <span>{row[2]}</span>
                  <span>{row[3]}</span>
                </div>
              ))}
            </div>
          </section>

          {/* ── REFERRAL ── */}
          <section className="summer-referral" aria-label="Referral program">
            <p className="summer-kicker">Earn with Suwappu</p>
            <h2>30% of every trading fee. Forever.</h2>
            <p className="summer-referral__body">
              Refer a friend and earn 30% of the trading fees they generate — paid out automatically,
              on every chain. Grab your personal link with{' '}
              <code className="summer-referral__cmd">/ref</code> inside the bot.
            </p>
            <a
              className="summer-button summer-button--primary"
              href={TELEGRAM_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              Get your referral link
            </a>
          </section>

          {/* ── CTA ── */}
          <section className="summer-cta" aria-label="Get started">
            <p className="summer-kicker">Start now</p>
            <h2>Your next swap is one line away.</h2>
            <p className="summer-cta__lead">
              Open the bot, or install the SDK and connect your agent — best-price
              swaps, perps, and gasless trades across 40+ chains.
            </p>
            <code className="summer-cta__code">bun add @suwappu/sdk</code>
            <div className="summer-actions summer-cta__actions">
              <a
                className="summer-button summer-button--primary"
                href={TELEGRAM_URL}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open Telegram Bot
              </a>
              {WHATSAPP_ENABLED && (
                <a
                  className="summer-button summer-button--whatsapp"
                  href={WHATSAPP_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Chat on WhatsApp
                </a>
              )}
              <a className="summer-button summer-button--secondary" href="/docs">
                Read the docs
              </a>
            </div>
          </section>
        </div>

        <SummerFooter />
      </main>
    </>
  );
}
