'use client';

import { useState, useRef } from 'react';
import stats from '@/data/stats.generated.json';
import { motion, useInView, useReducedMotion, type Variants } from 'framer-motion';
import Terminal from './Terminal';
import TerminalErrorBoundary from './TerminalErrorBoundary';
import DocsMasonry from './DocsMasonry';
import { TELEGRAM_URL, WHATSAPP_URL, WHATSAPP_ENABLED } from '@/lib/links';

/* ================================================================
   Data
   ================================================================ */
const TOOLS = [
  { name: 'get_quote', desc: `Best-route quotes across ${stats.routerCount} providers` },
  { name: 'execute_swap', desc: 'Execute a previously obtained quote' },
  { name: 'get_portfolio', desc: 'Aggregated portfolio with USD values' },
  { name: 'get_prices', desc: 'Real-time token prices' },
  { name: 'list_chains', desc: 'Supported chains and metadata' },
  { name: 'list_tokens', desc: 'Searchable token registry per chain' },
  { name: 'get_tempo_tokens', desc: 'TIP-20 token list on Tempo mainnet' },
  { name: 'browse_mpp_directory', desc: 'Machine Payments Protocol (MPP) service directory' },
  { name: 'predict_markets', desc: 'Browse Polymarket prediction markets' },
  { name: 'predict_market_detail', desc: 'Live CLOB prices for a market outcome' },
];

type TabKey = 'swap' | 'perps' | 'predict' | 'lend';

const SDK_TABS: { key: TabKey; label: string }[] = [
  { key: 'swap', label: 'Swap' },
  { key: 'perps', label: 'Perps' },
  { key: 'predict', label: 'Predict' },
  { key: 'lend', label: 'Lend' },
];

const SDK_EXAMPLES: Record<TabKey, string> = {
  swap: `import { Suwappu } from '@suwappu/sdk'

const client = new Suwappu({
  apiKey: process.env.SUWAPPU_KEY
})

const quote = await client.getQuote({
  from: 'USDC',
  to: 'ETH',
  chain: 'base',
  amount: '1000'
})

const tx = await client.swap(quote)`,
  perps: `const position = await client.perps.open({
  market: 'ETH-USD',
  side: 'long',
  size: '0.5',
  leverage: 10,
  chain: 'arbitrum'
})

// position.entryPrice: 3245.80
// position.liquidationPrice: 2921.22`,
  predict: `const markets = await client.predict.list({
  category: 'crypto',
  chain: 'polygon'
})

const bet = await client.predict.buy({
  marketId: markets[0].id,
  outcome: 'yes',
  amount: '50'
})`,
  lend: `const supply = await client.lend.supply({
  token: 'USDC',
  amount: '5000',
  protocol: 'aave',
  chain: 'base'
})

// supply.apy: 4.2%
// supply.txHash: 0x8b2f...a1e3`,
};

const STATS = [
  { value: '15', label: 'Chains' },
  { value: '9', label: 'Routers' },
  { value: '13', label: 'Tools' },
  { value: '$0.12', label: 'Avg gas' },
];

const FEATURES = [
  {
    icon: '🌐',
    title: 'Cross-chain by default',
    description:
      'Ethereum, Base, Arbitrum, Solana, Polygon, BSC, Avalanche, and 8 more. One SDK handles routing across all of them.',
  },
  {
    icon: '🛡️',
    title: 'MEV-shielded routing',
    description:
      'Every swap is protected from sandwich attacks. Your agent gets the price it was quoted — no front-running, no funny business.',
  },
  {
    icon: '🔑',
    title: 'Secure key management',
    description:
      'Keys encrypted with KMS envelope encryption and signed server-side — or bring your own keys via the agent API for full self-custody.',
  },
  {
    icon: '🔌',
    title: 'Multi-platform access',
    description:
      'TypeScript SDK, Telegram bot, WhatsApp bot, MCP server, REST API. Pick the interface that fits your workflow.',
  },
];

const STEPS = [
  {
    num: '1',
    title: 'Install',
    desc: 'One command. Fifteen chains. Zero config.',
    code: `$ bun add @suwappu/sdk\n✓ installed @suwappu/sdk@0.1.0`,
  },
  {
    num: '2',
    title: 'Quote',
    desc: `Best route across ${stats.routerCount} routers. MEV-shielded. Gas optimized.`,
    code: `const quote = await client.getQuote({
  from: 'USDC', to: 'ETH',
  chain: 'base', amount: '1000'
})
// → 1 ETH via Uniswap V3 | Gas ~$0.12`,
  },
  {
    num: '3',
    title: 'Swap',
    desc: 'Non-custodial. On-chain. Done.',
    code: `const tx = await client.swap(quote)
// ✓ Tx 0x3f8a...c291 confirmed
// status: success`,
  },
];

/* ================================================================
   Scroll-triggered reveal
   ================================================================ */
const revealVariants: Variants = {
  hidden: { opacity: 0, y: 32 },
  visible: { opacity: 1, y: 0 },
};

const staggerContainer: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.1 } },
};

const staggerItem: Variants = {
  hidden: { opacity: 0, y: 24 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.25, 0.4, 0.25, 1] } },
};

function Reveal({ children, className = '', delay = 0 }: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: '-80px' });
  const prefersReduced = useReducedMotion();

  return (
    <motion.div
      ref={ref}
      className={className}
      initial={prefersReduced ? 'visible' : 'hidden'}
      animate={inView ? 'visible' : 'hidden'}
      variants={revealVariants}
      transition={prefersReduced ? { duration: 0 } : { duration: 0.6, delay, ease: [0.25, 0.4, 0.25, 1] }}
    >
      {children}
    </motion.div>
  );
}

function StaggerReveal({ children, className = '' }: {
  children: React.ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: '-60px' });
  const prefersReduced = useReducedMotion();

  return (
    <motion.div
      ref={ref}
      className={className}
      initial={prefersReduced ? 'visible' : 'hidden'}
      animate={inView ? 'visible' : 'hidden'}
      variants={prefersReduced ? {} : staggerContainer}
    >
      {children}
    </motion.div>
  );
}

/* ================================================================
   Main content
   ================================================================ */
export default function Overlay() {
  const [activeTab, setActiveTab] = useState<TabKey>('swap');

  return (
    <main id="main-content">
      {/* ── HERO ── */}
      <section style={{ paddingTop: '7rem' }}>
        <div className="section" style={{ textAlign: 'center', paddingBottom: '3rem' }}>
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: [0.25, 0.4, 0.25, 1] }}
          >
            <p className="section__label">Cross-chain DEX infrastructure</p>
            <h1 className="hero__title" style={{ textAlign: 'center', maxWidth: 700, margin: '0 auto 1.5rem' }}>
              Swap anything.<br />
              <span className="hero__title-accent">Everywhere.</span>
            </h1>
            <p className="hero__subtitle" style={{ textAlign: 'center', maxWidth: 560, margin: '0 auto 2rem' }}>
              One SDK. Fifteen chains. Trading terminal, Telegram bot, REST API, MCP server — all in one platform.
            </p>
            <div className="hero__actions" style={{ justifyContent: 'center' }}>
              <motion.a
                href={TELEGRAM_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn--primary"
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
              >
                Start Trading
              </motion.a>
              {WHATSAPP_ENABLED && (
                <motion.a
                  href={WHATSAPP_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn--whatsapp"
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.97 }}
                >
                  Chat on WhatsApp
                </motion.a>
              )}
              <motion.a
                href={TELEGRAM_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn--secondary"
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
              >
                Open @suwappu_bot
              </motion.a>
              <motion.button
                className="btn btn--code"
                onClick={() => navigator.clipboard.writeText('bun add @suwappu/sdk')}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.97 }}
              >
                <span className="prompt">$</span> bun add @suwappu/sdk
              </motion.button>
            </div>
          </motion.div>
        </div>

        {/* Terminal Preview */}
        <motion.div
          initial={{ opacity: 0, y: 60 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.3, ease: [0.25, 0.4, 0.25, 1] }}
          className="terminal-embed"
        >
          <a href="https://terminal.suwappu.bot" target="_blank" rel="noopener noreferrer" className="terminal-embed__link">
            <div className="terminal-embed__mockup">
              <div className="terminal-embed__bar">
                <span className="code-block__dot code-block__dot--red" />
                <span className="code-block__dot code-block__dot--yellow" />
                <span className="code-block__dot code-block__dot--green" />
                <span style={{ marginLeft: 12, fontSize: '0.75rem', color: '#666' }}>terminal.suwappu.bot</span>
              </div>
              <div className="terminal-embed__body">
                <div className="terminal-embed__grid">
                  <div className="terminal-embed__panel terminal-embed__panel--chart">
                    <div style={{ fontSize: '0.6875rem', color: 'var(--suwappu-summer-accent)', marginBottom: 4 }}>ETH / USDC</div>
                    <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#fff' }}>$2,847.32</div>
                    <div style={{ fontSize: '0.6875rem', color: '#86efac' }}>+3.2% 24h</div>
                    <div style={{ marginTop: 16, height: 80, background: 'linear-gradient(180deg, rgba(14,165,233,0.15) 0%, transparent 100%)', borderRadius: 8, position: 'relative', overflow: 'hidden' }}>
                      <svg viewBox="0 0 200 60" style={{ width: '100%', height: '100%' }} preserveAspectRatio="none">
                        <polyline fill="none" stroke="var(--suwappu-summer-accent)" strokeWidth="2" points="0,45 20,40 40,42 60,30 80,35 100,20 120,25 140,15 160,18 180,10 200,12" />
                      </svg>
                    </div>
                  </div>
                  <div className="terminal-embed__panel terminal-embed__panel--swap">
                    <div style={{ fontSize: '0.6875rem', color: '#999', marginBottom: 8 }}>Swap</div>
                    <div style={{ background: '#1a1a1a', borderRadius: 8, padding: '8px 10px', marginBottom: 6, fontSize: '0.75rem' }}>
                      <span style={{ color: '#999' }}>From</span> <span style={{ color: '#fff', float: 'right' }}>1.0 ETH</span>
                    </div>
                    <div style={{ background: '#1a1a1a', borderRadius: 8, padding: '8px 10px', marginBottom: 10, fontSize: '0.75rem' }}>
                      <span style={{ color: '#999' }}>To</span> <span style={{ color: '#fff', float: 'right' }}>2,847 USDC</span>
                    </div>
                    <div style={{ background: 'var(--suwappu-summer-accent)', borderRadius: 8, padding: '6px 0', textAlign: 'center', fontSize: '0.75rem', fontWeight: 600, color: '#fff' }}>Execute Swap</div>
                  </div>
                  <div className="terminal-embed__panel terminal-embed__panel--book">
                    <div style={{ fontSize: '0.6875rem', color: '#999', marginBottom: 6 }}>Order Book</div>
                    {[2849, 2848, 2847].map((p, i) => (
                      <div key={p} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.625rem', padding: '2px 0', color: i < 2 ? '#f87171' : '#86efac' }}>
                        <span>{p}.{10 + i * 20}</span>
                        <span style={{ color: '#666' }}>{(0.5 + i * 0.3).toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
            <div className="terminal-embed__cta">Click to launch the full terminal</div>
          </a>
          <div className="terminal-embed__fade" />
        </motion.div>
      </section>

      {/* ── SDK DEMO (terminal typewriter) ── */}
      <section className="section" style={{ paddingTop: '2rem' }}>
        <div className="sdk-demo-grid">
          <Reveal>
            <p className="section__label">SDK in action</p>
            <h2 className="section__heading">Three calls. Done.</h2>
            <p className="section__body">
              Install the SDK, get a quote, execute the swap. Non-custodial, MEV-shielded, across 15 chains.
            </p>
          </Reveal>
          <Reveal delay={0.2}>
            <TerminalErrorBoundary>
              <Terminal />
            </TerminalErrorBoundary>
          </Reveal>
        </div>
      </section>

      {/* ── STATS ── */}
      <div className="section">
        <div className="stats-bar">
          {STATS.map((stat) => (
            <div key={stat.label} className="stat">
              <div className="stat__value">{stat.value}</div>
              <div className="stat__label">{stat.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── HOW IT WORKS ── */}
      <section id="how-it-works" className="section">
        <Reveal>
          <p className="section__label">How it works</p>
          <h2 className="section__heading">Three calls. That&apos;s it.</h2>
          <p className="section__body">
            From zero to cross-chain swaps in under a minute. No config files, no provider setup, no chain management.
          </p>
        </Reveal>

        <StaggerReveal className="steps-grid">
          {STEPS.map((step) => (
            <motion.div key={step.num} className="step-card" variants={staggerItem}>
              <div className="step-card__num">{step.num}</div>
              <h3 className="step-card__title">{step.title}</h3>
              <p className="step-card__desc">{step.desc}</p>
              <pre className="step-card__code">{step.code}</pre>
            </motion.div>
          ))}
        </StaggerReveal>
      </section>

      {/* ── INFRASTRUCTURE (dark section) ── */}
      <div className="dark-section">
        <div className="section">
          <Reveal>
            <p className="section__label">Infrastructure</p>
            <h2 className="section__heading">10 tools. One import.</h2>
            <p className="section__body">
              Swaps, quotes, portfolios, token prices, chain discovery, prediction markets — all from a single SDK.
            </p>
          </Reveal>

          {/* SDK code examples */}
          <Reveal delay={0.15}>
            <div className="code-block" style={{ marginTop: '2rem', background: '#111' }}>
              <div className="code-block__header" style={{ borderColor: '#222' }}>
                <span className="code-block__dot code-block__dot--red" />
                <span className="code-block__dot code-block__dot--yellow" />
                <span className="code-block__dot code-block__dot--green" />
                <span className="code-block__filename">index.ts</span>
                <div className="code-block__tabs">
                  {SDK_TABS.map((tab) => (
                    <button
                      key={tab.key}
                      onClick={() => setActiveTab(tab.key)}
                      className={`code-block__tab ${activeTab === tab.key ? 'code-block__tab--active' : ''}`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              </div>
              <motion.pre
                key={activeTab}
                className="code-block__body"
                initial={{ opacity: 0, x: 8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.25 }}
              >
                {SDK_EXAMPLES[activeTab]}
              </motion.pre>
            </div>
          </Reveal>

          {/* All tools grid */}
          <Reveal delay={0.3}>
            <h3 style={{ color: '#999', fontSize: '0.8125rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: '3rem', marginBottom: '0.5rem' }}>All 10 tools</h3>
            <div className="tools-grid">
              {TOOLS.map((tool) => (
                <div key={tool.name} className="tool">
                  <code className="tool__name">{tool.name}</code>
                  <span className="tool__desc">{tool.desc}</span>
                </div>
              ))}
            </div>
          </Reveal>
        </div>
      </div>

      {/* ── FEATURES ── */}
      <section id="features" className="section">
        <Reveal>
          <p className="section__label">Features</p>
          <h2 className="section__heading">
            Built for agents.<br />Ready for humans.
          </h2>
        </Reveal>

        <StaggerReveal className="features-grid">
          {FEATURES.map((feat) => (
            <motion.div
              key={feat.title}
              className="feature-card"
              variants={staggerItem}
              whileHover={{ y: -3 }}
            >
              <div className="feature-card__icon">{feat.icon}</div>
              <h3 className="feature-card__title">{feat.title}</h3>
              <p className="feature-card__desc">{feat.description}</p>
            </motion.div>
          ))}
        </StaggerReveal>
      </section>

      {/* ── DOCS MASONRY ── */}
      <DocsMasonry />

      {/* ── CTA ── */}
      <section className="section cta-section">
        <Reveal>
          <h2 className="section__heading" style={{ textAlign: 'center' }}>
            Your next swap is<br />one line away.
          </h2>
          <p className="section__body" style={{ textAlign: 'center', margin: '0 auto 2rem' }}>
            Install the SDK, connect your agent, and start swapping across 15 chains.
          </p>
          <code className="cta__code">bun add @suwappu/sdk</code>
          <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', flexWrap: 'wrap' }}>
            <motion.a
              href={TELEGRAM_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn--primary"
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
            >
              Open @suwappu_bot
            </motion.a>
            {WHATSAPP_ENABLED && (
              <motion.a
                href={WHATSAPP_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn--whatsapp"
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
              >
                Chat on WhatsApp
              </motion.a>
            )}
            <motion.a
              href="/docs"
              className="btn btn--secondary"
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
            >
              Read the docs
            </motion.a>
          </div>
        </Reveal>
      </section>

      {/* ── FOOTER ── */}
      <footer className="footer">
        <div className="footer__grid">
          <div>
            <div className="footer__brand">suwappu</div>
            <p className="footer__tagline">
              Cross-chain DEX infrastructure.<br />
              Swap anything. Everywhere.
            </p>
          </div>
          <div>
            <h3 className="footer__heading">Product</h3>
            <ul className="footer__list">
              <li><a href="https://t.me/suwappu_bot" target="_blank" rel="noopener noreferrer">Telegram Bot</a></li>
              <li><a href="/docs/protocols/mcp">Mini App</a></li>
              <li><a href="/docs/protocols/mcp">SDK</a></li>
              <li><a href="/docs/protocols/mcp">MCP Server</a></li>
              <li><a href="/docs/api-reference/perps">REST API</a></li>
            </ul>
          </div>
          <div>
            <h3 className="footer__heading">Developers</h3>
            <ul className="footer__list">
              <li><a href="/docs">Documentation</a></li>
              <li><a href="https://github.com/0xSoftBoi/suwappubot" target="_blank" rel="noopener noreferrer">GitHub</a></li>
              <li><a href="/docs/api-reference/perps">API Reference</a></li>
            </ul>
          </div>
          <div>
            <h3 className="footer__heading">Community</h3>
            <ul className="footer__list">
              <li><a href="https://t.me/suwappu_bot" target="_blank" rel="noopener noreferrer">Telegram</a></li>
              <li><a href="https://x.com/suwappubot" target="_blank" rel="noopener noreferrer">X (Twitter)</a></li>
            </ul>
          </div>
        </div>
        <div className="footer__bottom">
          <span>&copy; 2026 Suwappu. All rights reserved.</span>
          <span>Built with care in Tokyo.</span>
        </div>
      </footer>
    </main>
  );
}
