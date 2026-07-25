import { Suspense } from 'react';
import Image from 'next/image';
import StructuredData from '@/components/StructuredData';
import LiveTerminal from '@/components/LiveTerminal';
import SummerFooter from '@/components/SummerFooter';
import CosmicAtmosphere from '@/components/CosmicAtmosphere';
import CopyInstall from '@/components/CopyInstall';
import MarketProof from '@/components/MarketProof';
import MobileWaitlistForm from '@/components/MobileWaitlistForm';
import StatsStrip from '@/components/StatsStrip';
import { getTranslations } from 'next-intl/server';
import { TELEGRAM_URL, WHATSAPP_URL, WHATSAPP_ENABLED } from '@/lib/links';
import DemoCallCta from '@/components/DemoCallCta';
import productStats from '@/data/stats.generated.json';
import styles from './home.module.css';

// Revalidate the homepage every 60s so MarketProof's live prices stay fresh (ISR).
export const revalidate = 60;

const TERMINAL_URL = 'https://terminal.suwappu.bot';

// Outcome-first stats — product facts only, no unverifiable usage/volume claims.
const stats = [
  // "Integrated", not "raced per quote": providers are chain-gated, so any single
  // swap races the subset that supports its route, never all of them.
  { value: String(productStats.routerCount), label: 'Routing providers integrated' },
  { value: String(productStats.platformChains), label: 'Chains supported' },
  { value: 'Sub-second', label: 'Quote latency' },
  { value: 'Non-custodial', label: 'Always your keys' },
];

// Cross-chain engine — noun-phrase titles, numbers carried in the body copy.
// Cells 1 and 4 are the wide bento cells and render in the dark register.
const engineFeatures = [
  {
    mark: 'fruit',
    title: 'Best-price routing',
    description:
      `Every provider that supports your route races to quote it — ${productStats.routerCount} integrated, including Li.Fi, CoW, OKX, 1inch, KyberSwap, Across, Wormhole, and Jupiter. You get the winner, automatically.`,
  },
  {
    mark: 'sun',
    title: 'Pre-trade simulation',
    description:
      `Bad fills are flagged before you confirm. Every route is priced across ${productStats.platformChains} chains before a single transaction is signed.`,
  },
  {
    mark: 'soft',
    title: 'MPC key security',
    description:
      'MPC architecture with KMS envelope encryption. No custody, no counterparty risk. Bring your own keys via the agent API for full self-custody.',
  },
  {
    mark: 'mist',
    title: 'One execution layer',
    description:
      'Telegram bot, web terminal, REST API, and MCP server all call the same router — identical pricing, settlement, and guardrails behind every surface.',
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
    // Agent-API scope, NOT the platform total — GET /v1/agent/chains is authoritative.
    stat: `${productStats.agentApiChains} chains`,
  },
  {
    eyebrow: 'Fast command lane',
    title: 'Telegram bot',
    body: 'Quote, swap, snipe, run perps, stake, set DCA, copy traders, or watch a wallet — all without leaving the chat.',
    stat: '@suwappu_bot',
  },
];

// HyperLiquid — institutional-grade perps, outcome-led.
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

// Chain and router logos — clean integration strip, no verify clutter.
const trustChains = [
  'Ethereum', 'Base', 'Arbitrum', 'Optimism', 'Solana', 'Polygon',
  'BSC', 'Avalanche', 'Starknet', 'HyperLiquid', 'Tempo',
];
const trustRouters = ['LiFi', 'CoW', 'OKX', '1inch', 'KyberSwap', 'Jupiter', 'Across', 'CCTP'];

// Agent cards — outcome titles, agentic-era framing.
const agentCards = [
  {
    tag: 'MCP server',
    title: 'Works with Cursor, Claude, and any MCP client',
    body: 'Quotes, swaps, perps, and portfolio as agent-callable tools. Drop into Claude Desktop, Cursor, or Windsurf in 30 seconds.',
  },
  {
    tag: 'SDK + REST',
    title: 'Ship in TypeScript or Python',
    body: '`bun add @suwappu/sdk` or call the REST API directly — the exact execution layer the terminal runs on.',
  },
  {
    tag: 'Discoverable',
    title: 'Agents find you via llms.txt and OpenAPI',
    body: 'Machine-readable docs and an agent manifest so any LLM can discover every available action without hand-holding.',
  },
  {
    tag: 'Guardrails',
    title: 'Risk limits built in — agents can\'t overspend',
    body: 'Per-key slippage caps, spend limits, allowed chains and pairs, plus 2FA. Autonomous agents act inside rails you define.',
  },
];

// Real, copyable @suwappu/sdk agent flow: quote → execute the swap.
// Mirrors packages/sdk (new Suwappu, getQuote, swap) — every call is real.
const agentSnippet = `import { Suwappu } from "@suwappu/sdk";

const client = new Suwappu({ apiKey: process.env.SUWAPPU_API_KEY });

// Your agent quotes the route, then executes the swap.
const quote = await client.getQuote({
  from: "USDC", to: "ETH", chain: "base", amount: "1000",
});
const tx = await client.swap(quote);
console.log(tx.txHash, tx.status);   // -> 0x… "filled"`;

async function Hero() {
  const t = await getTranslations('hero');
  return (
    <section className="summer-hero">
      {/* Grain rides a dedicated overlay: .summer-hero already owns ::after. */}
      <div className={`sw-grain ${styles.heroGrain}`} aria-hidden="true" />
      <div className="summer-flower-field summer-flower-field--hero" aria-hidden="true">
        <span className="summer-flower summer-flower--soft" />
        <span className="summer-flower summer-flower--sun" />
        <span className="summer-flower summer-flower--mist" />
        <span className="summer-petal summer-petal--sky" />
        <span className="summer-petal summer-petal--blush" />
      </div>
      <Image
        className="summer-hero__fruit"
        src="/logo.svg"
        alt=""
        aria-hidden="true"
        width={86}
        height={86}
        priority
      />
      <div className="summer-hero__copy">
        <p className="summer-kicker">{t('kicker')}</p>
        <h1 className={`summer-hero__h1 sw-display-1 ${styles.heroTitle}`}>
          {t('h1')}{' '}
          <span className="summer-hero__accent">{t('h1_accent')}</span>
        </h1>
        <p className="summer-hero__lead">{t('lead')}</p>
        <div className="summer-actions">
          <a
            className="summer-button summer-button--primary"
            href={TELEGRAM_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            {t('cta_bot')}
          </a>
          <a className="summer-button summer-button--secondary" href={TERMINAL_URL}>
            {t('cta_terminal')}
          </a>
        </div>
        <CopyInstall text="bun add @suwappu/sdk" />
        {/* Trust micro-copy — security as a feature, not a footnote. */}
        <p className="summer-hero__trust">
          Non-custodial&nbsp;·&nbsp;No KYC for basic swaps&nbsp;·&nbsp;MPC key security
        </p>
        <a className="summer-hero__waitlist-pill" href="#mobile-app">
          iOS and Android, with the Suwappu Card by Rain — join the waitlist
        </a>
      </div>
      <LiveTerminal className={styles.termFrame} />
    </section>
  );
}

/**
 * Streamed placeholder for MarketProof. Deliberately carries no `id="bot"` —
 * the anchor belongs to the real section so nav scroll-spy never binds to a
 * node that is about to be replaced.
 */
function MarketProofSkeleton() {
  return (
    <div className={styles.proofSkeleton} aria-hidden="true">
      <div className={`${styles.proofSkeletonKicker} ${styles.shimmer}`} />
      <div className={`${styles.proofSkeletonHead} ${styles.shimmer}`} />
      <div className={styles.proofSkeletonRows}>
        {[0, 1, 2, 3, 4].map((i) => (
          <div className={`${styles.proofSkeletonRow} ${styles.shimmer}`} key={i} />
        ))}
      </div>
    </div>
  );
}

export default async function Home() {
  const tRef = await getTranslations('referral');
  const tCta = await getTranslations('cta');
  return (
    <>
      <StructuredData />
      <main id="main-content" className="summer-page summer-page--cosmic">
        <CosmicAtmosphere />
        <div className="summer-bg summer-bg--stem" aria-hidden="true" />
        <div className="summer-bg summer-bg--bloom" aria-hidden="true" />
        <div className="summer-mobile-rail" aria-hidden="true">
          <Image src="/logo.svg" alt="" aria-hidden="true" width={34} height={34} />
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
            <a href="#mobile-app">Mobile app</a>
          </nav>
          <a className="summer-nav__cta" href={TELEGRAM_URL} target="_blank" rel="noopener noreferrer">
            Open Bot
          </a>
          <a className="summer-nav__cta summer-nav__cta--ghost" href={TERMINAL_URL}>
            Open Terminal
          </a>
        </header>

        <div className={`summer-shell ${styles.shell}`}>
          <Hero />

          {/* ── STATS STRIP — count-up numerals, final values server-rendered ── */}
          <StatsStrip stats={stats} />

          {/* ── ROUTES ACROSS — clean integration strip ── */}
          <section className="summer-trust" aria-label="Routes across">
            <p className="summer-trust__label">
              Routes across {productStats.platformChains} chains and{' '}
              {productStats.routerCount} liquidity networks
            </p>
            <div className="summer-trust__rows">
              <div className="summer-trust__group">
                <span>Chains</span>
                <div className="summer-trust__chips">
                  {trustChains.map((c) => (
                    <b key={c}>{c}</b>
                  ))}
                  {/* Derived, never hardcoded: stats.generated.json owns the total. */}
                  <b>+{productStats.platformChains - trustChains.length} more</b>
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
          </section>

          {/* ── MOBILE APP WAITLIST — Suwappu Card by Rain ── */}
          <section id="mobile-app" className="summer-mobile" aria-label="Mobile app waitlist">
            <span className="summer-flower summer-flower--sun summer-mobile__flower" aria-hidden="true" />
            <div className="summer-mobile__copy">
              <p className="summer-kicker">Coming soon — iOS &amp; Android</p>
              <h2>Suwappu, in your pocket. With the Suwappu Card by Rain.</h2>
              <p>
                The full swap engine and terminal, native on your phone — plus the
                Suwappu Card by Rain, a crypto-linked card you can spend anywhere.
                Get on the list and we&rsquo;ll email you the moment your device is
                supported.
              </p>
              <div className="summer-mobile__tags">
                <span>iOS</span>
                <span>Android</span>
                <span>Suwappu Card by Rain</span>
                <span>Non-custodial</span>
              </div>
            </div>
            <div className="summer-mobile__panel">
              <MobileWaitlistForm />
            </div>
          </section>

          {/* ── CROSS-CHAIN ENGINE — outcome cards ── */}
          <section id="engine" className="summer-features" aria-label="Cross-chain engine">
            <div className="summer-features__head">
              <p className="summer-kicker">The engine</p>
              <h2>One router across {productStats.platformChains} chains.</h2>
            </div>
            <div className="summer-features__grid">
              {engineFeatures.map((feature, index) => {
                // Cells 1 and 4 are the wide bento cells — dark register.
                const wide = index === 0 || index === 3;
                return (
                  <article
                    className={`summer-feature sw-rise${
                      wide ? ` sw-card-dark ${styles.bentoLarge}` : ''
                    }`}
                    key={feature.title}
                    style={{ '--rise-i': index } as React.CSSProperties}
                  >
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
                );
              })}
            </div>
          </section>

          {/* ── PRODUCT MODULES ── */}
          <section id="terminal" className="summer-modules" aria-label="Product modules">
            {modules.map((module, index) => (
              <article
                className="summer-module sw-rise"
                key={module.title}
                style={{ '--rise-i': index } as React.CSSProperties}
              >
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

          {/* ── INSTITUTIONAL-GRADE PERPS (HyperLiquid) ── */}
          <section id="hyperliquid" className="summer-hub" aria-label="Institutional-grade perps">
            <div className="summer-flower summer-flower--sun summer-hub__flower" aria-hidden="true" />
            <div className="summer-hub__head">
              <div>
                <p className="summer-kicker">Institutional-grade perps</p>
                <h2>Up to 20x leverage. Managed from chat.</h2>
              </div>
              <p>
                The full HyperLiquid ecosystem from inside the bot — fund your
                HyperCore account from any chain, trade perps up to 20x on the
                fastest on-chain perp exchange, stake HYPE, and earn in vaults.
                No bridging tabs, no address pasting.
              </p>
            </div>
            <div className="summer-hub__grid">
              {hyperliquid.map((card, index) => (
                <article
                  className="summer-hub__card sw-rise"
                  key={card.cmd}
                  style={{ '--rise-i': index } as React.CSSProperties}
                >
                  <code className="summer-hub__cmd">{card.cmd}</code>
                  <h3>{card.title}</h3>
                  <p>{card.body}</p>
                </article>
              ))}
            </div>
          </section>

          {/* ── GASLESS SWAPS ON TEMPO ── */}
          <section id="tempo" className="summer-tempo" aria-label="Gasless swaps on Tempo">
            <div className="summer-flower summer-flower--mist summer-tempo__flower" aria-hidden="true" />
            <div className="summer-tempo__copy">
              <p className="summer-kicker">Gasless swaps on Tempo</p>
              <h2>Trade without holding gas tokens.</h2>
              <p>
                Suwappu sponsors your transaction fees on Tempo chains — you swap
                TIP-20 stablecoins for about a tenth of a cent while we cover the
                rest. Falls back to a normal swap if sponsorship is unavailable, so
                nothing ever blocks.
              </p>
              <div className="summer-tempo__tags">
                <span>Type 0x76 fee-payer</span>
                <span>~$0.001 per swap</span>
                <span>Micropayments (/mpp)</span>
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

          {/* ── BUILD TRADING AGENTS — developer section ── */}
          <section id="api" className="summer-sdk">
            <div className="summer-flower summer-flower--mist summer-sdk__flower" aria-hidden="true" />
            <div>
              <p className="summer-kicker">Agent API &amp; SDK</p>
              <h2>Two calls from quote to settlement.</h2>
              <p>
                The same execution surface the terminal runs on, exposed as a
                TypeScript SDK, an MCP server, and a REST API — swaps, perps,
                prediction markets, and lending across {productStats.agentApiChains}{' '}
                agent-ready chains.
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
            <div className="summer-code" aria-label="Agent quote and swap example">
              <div className="summer-code__bar">
                <span />
                <span />
                <span />
                <b>agent.ts</b>
              </div>
              <pre>
                <code>{agentSnippet}</code>
              </pre>
            </div>
          </section>

          {/* ── NON-CUSTODIAL PLEDGE ── */}
          <section className="summer-pledge" aria-label="Non-custodial">
            <span className="summer-flower summer-flower--soft summer-pledge__mark" aria-hidden="true" />
            <p className="summer-kicker">Non-custodial by design</p>
            <p className="summer-pledge__body">
              Suwappu is non-custodial. We never hold your keys or your funds. We provide
              the routing and settlement layer — your tokens stay yours, end to end.
            </p>
          </section>

          {/* ── BUILT FOR THE AGENTIC ERA ── */}
          <section id="agents" className="summer-agents" aria-label="Built for the agentic era">
            <div className="summer-flower summer-flower--soft summer-agents__flower" aria-hidden="true" />
            <div className="summer-agents__head">
              <p className="summer-kicker">Built for the agentic era</p>
              <h2>Let an agent execute. You set the limits.</h2>
              <p>
                Suwappu exposes the same execution surface as an MCP server, a
                TypeScript SDK, and a REST API across {productStats.agentApiChains} agent-ready chains —
                discoverable through llms.txt and an agent manifest, with policy
                guardrails so autonomous swaps stay inside the rails you define. No
                signup required: register for a key instantly, or pay per call over
                HTTP 402 with <a href="/docs/billing/agentic-payments">x402</a> and
                skip registration entirely.
              </p>
            </div>
            <div className="summer-agents__grid">
              {agentCards.map((card, index) => (
                <article
                  className="summer-agents__card sw-rise"
                  key={card.tag}
                  style={{ '--rise-i': index } as React.CSSProperties}
                >
                  <b>{card.tag}</b>
                  <h3>{card.title}</h3>
                  <p>{card.body}</p>
                </article>
              ))}
            </div>
            <div className="summer-code summer-agents__code" aria-label="MCP server configuration">
              <div className="summer-code__bar">
                <span />
                <span />
                <span />
                <b>claude_desktop_config.json</b>
              </div>
              <pre>
                <code>{`{
  "mcpServers": {
    "suwappu": {
      "command": "npx",
      "args": ["@suwappu/mcp-server"],
      "env": { "SUWAPPU_API_KEY": "sk_..." }
    }
  }
}`}</code>
              </pre>
            </div>
          </section>

          {/* ── DEVELOPER QUICKSTART (agent trading layer) ── */}
          <section id="build" className="summer-devlayer" aria-label="Build with Suwappu">
            <div className="summer-devlayer__head">
              <p className="summer-kicker">For builders</p>
              {/* The polish layer does not scale this head — display-2 applies here. */}
              <h2 className={`sw-display-2 ${styles.h2Scale}`}>
                Your AI agent&apos;s trading layer.
              </h2>
              <p>
                Native MCP, TypeScript and Python SDKs, and org-scoped API keys with
                per-key spend caps — built for agents, not just humans.
              </p>
            </div>
            <div className="summer-devlayer__grid">
              {/* MCP card */}
              <article
                className="summer-devlayer__card sw-rise"
                style={{ '--rise-i': 0 } as React.CSSProperties}
              >
                <b>MCP server</b>
                <h3>Connect in 30 seconds</h3>
                <p>Drop into Claude Desktop, Cursor, Windsurf, or any MCP host — no extra infra.</p>
                <div className="summer-code summer-devlayer__snippet">
                  <div className="summer-code__bar">
                    <span /><span /><span />
                    <b>claude_desktop_config.json</b>
                  </div>
                  <pre>
                    <code>{`{
  "mcpServers": {
    "suwappu": {
      "url": "https://api.suwappu.bot/mcp",
      "headers": {
        "X-API-Key": "YOUR_API_KEY"
      }
    }
  }
}`}</code>
                  </pre>
                </div>
              </article>

              {/* SDK card */}
              <article
                className="summer-devlayer__card sw-rise"
                style={{ '--rise-i': 1 } as React.CSSProperties}
              >
                <b>TypeScript SDK</b>
                <h3>npm install @suwappu/sdk</h3>
                <p>Swap, perps, predict, lending — one typed client across {productStats.platformChains} chains.</p>
                <div className="summer-code summer-devlayer__snippet">
                  <div className="summer-code__bar">
                    <span /><span /><span />
                    <b>swap.ts</b>
                  </div>
                  <pre>
                    <code>{`import { Suwappu } from "@suwappu/sdk";
const client = new Suwappu({ apiKey: process.env.SUWAPPU_KEY });
const quote = await client.getQuote({
  from: "USDC", to: "ETH", chain: "base", amount: "100"
});
const tx = await client.swap(quote);`}</code>
                  </pre>
                </div>
              </article>

              {/* Enterprise card */}
              <article
                className="summer-devlayer__card summer-devlayer__card--enterprise sw-rise"
                style={{ '--rise-i': 2 } as React.CSSProperties}
              >
                <b>Enterprise API</b>
                <h3>Org keys, RBAC, metering</h3>
                <p>
                  Issue API keys per agent, set spend limits per key, track usage per team.
                  Built for multi-agent systems that need access control, not just auth tokens.
                </p>
                <div className="summer-devlayer__ent-tags">
                  <span>Org API keys</span>
                  <span>RBAC</span>
                  <span>Usage metering</span>
                  <span>Spend caps</span>
                  <span>Audit logs</span>
                </div>
                <DemoCallCta source="homepage_enterprise_card" className="summer-devlayer__ent-link">
                  Schedule a demo →
                </DemoCallCta>
              </article>
            </div>
            <div className="summer-devlayer__cta">
              <DemoCallCta source="homepage_enterprise_section" className="summer-button summer-button--primary">
                Schedule a demo
              </DemoCallCta>
              <a className="summer-button summer-button--secondary" href="/contact">
                Or send us a note
              </a>
              <a className="summer-devlayer__docs-link" href="/agents">
                Read the docs
              </a>
            </div>
          </section>

          {/* ── MARKET PROOF (live) ──
              Suspense lets the rest of the page stream while the 60s-ISR price
              fetch resolves; MarketProof keeps its own 3s abort + fallback. */}
          <Suspense fallback={<MarketProofSkeleton />}>
            <MarketProof />
          </Suspense>

          {/* ── REFERRAL ── */}
          <section className="summer-referral" aria-label="Referral program">
            <p className="summer-kicker">{tRef('kicker')}</p>
            <h2>{tRef('heading')}</h2>
            <p className="summer-referral__body">
              {tRef.rich('body', {
                cmd: (chunks) => <code className="summer-referral__cmd">{chunks}</code>,
              })}
            </p>
            <a
              className="summer-button summer-button--primary"
              href={TELEGRAM_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              {tRef('cta')}
            </a>
          </section>

          {/* ── CTA ── */}
          <section className="summer-cta" aria-label="Get started">
            <p className="summer-kicker">{tCta('kicker')}</p>
            <h2>{tCta('heading')}</h2>
            <p className="summer-cta__lead">{tCta('lead')}</p>
            <code className="summer-cta__code">bun add @suwappu/sdk</code>
            <div className="summer-actions summer-cta__actions">
              <a
                className="summer-button summer-button--primary"
                href={TELEGRAM_URL}
                target="_blank"
                rel="noopener noreferrer"
              >
                {tCta('open_bot')}
              </a>
              {WHATSAPP_ENABLED && (
                <a
                  className="summer-button summer-button--whatsapp"
                  href={WHATSAPP_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {tCta('whatsapp')}
                </a>
              )}
              <a className="summer-button summer-button--secondary" href="/docs">
                {tCta('docs')}
              </a>
            </div>
          </section>
        </div>

        <SummerFooter />
      </main>
    </>
  );
}
