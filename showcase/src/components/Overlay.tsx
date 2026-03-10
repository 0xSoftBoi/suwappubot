'use client';

import { useState, useRef } from 'react';
import { motion, useInView } from 'framer-motion';
import { usePlay } from '@/contexts/Play';
import Terminal from './Terminal';

/* ================================================================
   Data
   ================================================================ */
const TOOLS = [
  { name: 'swap', desc: 'Cross-chain token swaps' },
  { name: 'getQuote', desc: 'Best-route quotes with MEV shielding' },
  { name: 'getBalance', desc: 'Multi-chain token balances' },
  { name: 'getPortfolio', desc: 'Aggregated portfolio with USD values' },
  { name: 'getPrice', desc: 'Real-time token prices' },
  { name: 'getTokens', desc: 'Searchable token registry per chain' },
  { name: 'getChains', desc: 'Supported chains and metadata' },
  { name: 'createWallet', desc: 'Non-custodial TEE wallet creation' },
  { name: 'limitOrder', desc: 'On-chain limit orders' },
  { name: 'dcaOrder', desc: 'Dollar-cost averaging schedules' },
  { name: 'perps.open', desc: 'Perpetual futures positions' },
  { name: 'predict', desc: 'Prediction market positions' },
  { name: 'lend', desc: 'Lending and borrowing protocols' },
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
    title: 'Cross-chain by default',
    description:
      'Ethereum, Base, Arbitrum, Polygon, Solana, BSC, Avalanche, and more. One SDK handles routing across all of them.',
  },
  {
    title: 'MEV-shielded routing',
    description:
      'Every swap is protected from sandwich attacks and front-running. Your agent gets the price it was quoted.',
  },
  {
    title: 'Non-custodial execution',
    description:
      'Keys never leave your agent. Suwappu routes the trade — your agent signs and submits.',
  },
  {
    title: 'Multi-platform access',
    description:
      'SDK, Telegram bot, MCP server, REST API. Your agent picks the interface that fits.',
  },
];

const STEPS = [
  {
    num: '01',
    title: 'Install',
    desc: 'One command. Your agent connects to 15 chains instantly.',
    code: `$ bun add @suwappu/sdk\n✓ installed @suwappu/sdk@0.1.0`,
    color: '#ff2d78',
  },
  {
    num: '02',
    title: 'Quote',
    desc: 'Best route. MEV-shielded. Gas optimized across 9 routers.',
    code: `const quote = await client.getQuote({
  from: 'USDC', to: 'ETH',
  chain: 'base', amount: '1000'
})
// → 1 ETH via Uniswap V3 | Gas ~$0.12`,
    color: '#a855f7',
  },
  {
    num: '03',
    title: 'Swap',
    desc: 'Non-custodial. On-chain. Confirmed in seconds.',
    code: `const tx = await client.swap(quote)
// ✓ Tx 0x3f8a...c291 confirmed
// status: success`,
    color: '#6366f1',
  },
];

/* ================================================================
   Scroll-triggered reveal — Framer Motion
   ================================================================ */
const revealVariants = {
  hidden: { opacity: 0, y: 40, filter: 'blur(8px)' },
  visible: { opacity: 1, y: 0, filter: 'blur(0px)' },
};

const staggerContainer = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.12 } },
};

const staggerItem = {
  hidden: { opacity: 0, y: 30, filter: 'blur(6px)' },
  visible: { opacity: 1, y: 0, filter: 'blur(0px)', transition: { duration: 0.7, ease: [0.25, 0.4, 0.25, 1] } },
};

function Reveal({ children, className = '', delay = 0 }: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { margin: '-80px' });

  return (
    <motion.div
      ref={ref}
      className={className}
      initial="hidden"
      animate={inView ? 'visible' : 'hidden'}
      variants={revealVariants}
      transition={{ duration: 0.8, delay, ease: [0.25, 0.4, 0.25, 1] }}
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
  const inView = useInView(ref, { margin: '-60px' });

  return (
    <motion.div
      ref={ref}
      className={className}
      initial="hidden"
      animate={inView ? 'visible' : 'hidden'}
      variants={staggerContainer}
    >
      {children}
    </motion.div>
  );
}

/* ================================================================
   Overlay
   ================================================================ */
export default function Overlay() {
  const { play, setPlay } = usePlay();
  const [activeTab, setActiveTab] = useState<TabKey>('swap');

  return (
    <div className="overlay">
      {/* Loader */}
      <div className="loader loader--disappear" />

      {/* ──────────── INTRO ──────────── */}
      <div className={`intro ${play ? 'intro--disappear' : ''}`}>
        <motion.h1
          className="logo"
          initial={{ opacity: 0, y: 60, filter: 'blur(12px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          transition={{ duration: 1.8, ease: [0.25, 0.4, 0.25, 1] }}
        >
          suwappu
        </motion.h1>
        <motion.p
          className="intro__scroll"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.2, duration: 1 }}
        >
          Cross-chain DEX infrastructure
        </motion.p>
        <motion.button
          className="explore"
          onClick={() => setPlay(true)}
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 2, duration: 0.8, ease: [0.25, 0.4, 0.25, 1] }}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
        >
          Explore
        </motion.button>
      </div>

      {/* ──────────── SCROLLABLE CONTENT ──────────── */}
      {play && (
        <motion.div
          className="scroll-content"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.8 }}
        >

          {/* ── HERO ── */}
          <section className="sc-section sc-hero">
            <Reveal className="sc-hero__left">
              <span className="sc-label">Agent-driven DEX</span>
              <h2 className="sc-hero__title">
                Install the SDK,<br />get a quote, swap.
              </h2>
              <p className="sc-body">
                Three calls. Non-custodial. Fifteen chains.
              </p>
              <div className="sc-hero__actions">
                <motion.a
                  href="https://t.me/suwappu_bot"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="sc-btn sc-btn--primary"
                  whileHover={{ scale: 1.04, boxShadow: '0 0 30px rgba(255, 45, 120, 0.4)' }}
                  whileTap={{ scale: 0.97 }}
                >
                  Open @suwappu_bot
                </motion.a>
                <motion.button
                  className="sc-btn sc-btn--code"
                  onClick={() => navigator.clipboard.writeText('bun add @suwappu/sdk')}
                  whileHover={{ scale: 1.02, borderColor: 'rgba(255,255,255,0.2)' }}
                  whileTap={{ scale: 0.97 }}
                >
                  <span className="sc-btn__prompt">$</span> bun add @suwappu/sdk
                </motion.button>
              </div>
            </Reveal>
            <Reveal className="sc-hero__right" delay={0.3}>
              <Terminal />
            </Reveal>
          </section>

          {/* ── INFRASTRUCTURE ── */}
          <section className="sc-section sc-infra">
            <Reveal>
              <span className="sc-label">Infrastructure</span>
              <h2 className="sc-heading">
                13 Tools. <span className="sc-gradient-text">One SDK.</span>
              </h2>
            </Reveal>

            <div className="sc-bento">
              {/* Code editor */}
              <Reveal className="sc-bento__code" delay={0.1}>
                <div className="sc-code-header">
                  <span className="sc-dot sc-dot--red" />
                  <span className="sc-dot sc-dot--yellow" />
                  <span className="sc-dot sc-dot--green" />
                  <span className="sc-code-filename">index.ts</span>
                  <div className="sc-code-tabs">
                    {SDK_TABS.map((tab) => (
                      <button
                        key={tab.key}
                        onClick={() => setActiveTab(tab.key)}
                        className={`sc-code-tab ${activeTab === tab.key ? 'sc-code-tab--active' : ''}`}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>
                </div>
                <motion.pre
                  key={activeTab}
                  className="sc-code-body"
                  initial={{ opacity: 0, x: 8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.3 }}
                >
                  {SDK_EXAMPLES[activeTab]}
                </motion.pre>
              </Reveal>

              {/* Stats */}
              <StaggerReveal className="sc-bento__stats">
                {STATS.map((stat) => (
                  <motion.div key={stat.label} className="sc-stat" variants={staggerItem}>
                    <span className="sc-stat__label">{stat.label}</span>
                    <span className="sc-stat__value">{stat.value}</span>
                  </motion.div>
                ))}
              </StaggerReveal>

              {/* Install bar */}
              <Reveal className="sc-bento__install" delay={0.3}>
                <code>
                  <span className="text-noir-text-3">$ </span>
                  <span className="text-noir-text">bun add @suwappu/sdk</span>
                </code>
                <button
                  onClick={() => navigator.clipboard.writeText('bun add @suwappu/sdk')}
                  className="sc-copy-btn"
                  aria-label="Copy install command"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 01-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 011.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 00-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 01-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 00-3.375-3.375h-1.5a1.125 1.125 0 01-1.125-1.125v-1.5a3.375 3.375 0 00-3.375-3.375H9.75" />
                  </svg>
                </button>
              </Reveal>

              {/* Tools grid */}
              <Reveal className="sc-bento__tools" delay={0.4}>
                <h3 className="sc-tools-heading">All 13 tools</h3>
                <StaggerReveal className="sc-tools-grid">
                  {TOOLS.map((tool) => (
                    <motion.div key={tool.name} className="sc-tool" variants={staggerItem}>
                      <code className="sc-tool__name">{tool.name}</code>
                      <span className="sc-tool__desc">{tool.desc}</span>
                    </motion.div>
                  ))}
                </StaggerReveal>
              </Reveal>
            </div>
          </section>

          {/* ── HOW IT WORKS ── */}
          <section className="sc-section sc-steps">
            <Reveal>
              <span className="sc-label" style={{ color: '#a855f7' }}>How it works</span>
              <h2 className="sc-heading">Three calls. That&apos;s it.</h2>
              <p className="sc-body sc-body--wide">
                From zero to cross-chain swaps in under a minute.
              </p>
            </Reveal>

            <StaggerReveal className="sc-steps__grid">
              {STEPS.map((step) => (
                <motion.div
                  key={step.num}
                  className="sc-step"
                  variants={staggerItem}
                  whileHover={{ borderColor: `${step.color}33`, y: -4 }}
                  transition={{ duration: 0.3 }}
                >
                  <div className="sc-step__num" style={{ color: step.color }}>{step.num}</div>
                  <h3 className="sc-step__title">{step.title}</h3>
                  <p className="sc-step__desc">{step.desc}</p>
                  <pre className="sc-step__code">{step.code}</pre>
                </motion.div>
              ))}
            </StaggerReveal>
          </section>

          {/* ── FEATURES ── */}
          <section className="sc-section sc-features">
            <Reveal>
              <span className="sc-label">Features</span>
              <h2 className="sc-heading">
                Built for agents,<br />ready for humans
              </h2>
            </Reveal>

            <StaggerReveal className="sc-features__grid">
              {FEATURES.map((feat, i) => (
                <motion.div
                  key={feat.title}
                  className="sc-feature"
                  variants={staggerItem}
                  whileHover={{ borderColor: 'rgba(255,255,255,0.12)', y: -3 }}
                  transition={{ duration: 0.3 }}
                >
                  <span className="sc-feature__num">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <h3 className="sc-feature__title">{feat.title}</h3>
                  <p className="sc-feature__desc">{feat.description}</p>
                </motion.div>
              ))}
            </StaggerReveal>
          </section>

          {/* ── CTA ── */}
          <section className="sc-section sc-cta">
            <Reveal className="sc-cta__inner">
              <h2 className="sc-cta__title">Your next swap is one line away</h2>
              <p className="sc-body" style={{ textAlign: 'center', maxWidth: 520 }}>
                Install the SDK, connect your agent, and start swapping across 15+ chains in minutes.
              </p>
              <code className="sc-cta__code">bun add @suwappu/sdk</code>
              <div className="sc-cta__buttons">
                <motion.a
                  href="https://t.me/suwappu_bot"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="sc-btn sc-btn--primary"
                  whileHover={{ scale: 1.04, boxShadow: '0 0 30px rgba(255, 45, 120, 0.4)' }}
                  whileTap={{ scale: 0.97 }}
                >
                  Open @suwappu_bot
                </motion.a>
                <motion.a
                  href="https://docs.suwappu.bot"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="sc-btn sc-btn--ghost"
                  whileHover={{ scale: 1.04 }}
                  whileTap={{ scale: 0.97 }}
                >
                  Read the docs
                </motion.a>
              </div>
            </Reveal>
          </section>

          {/* ── FOOTER ── */}
          <footer className="sc-footer">
            <Reveal>
              <div className="sc-footer__grid">
                <div>
                  <h3 className="sc-footer__heading">Product</h3>
                  <ul className="sc-footer__list">
                    <li><a href="https://t.me/suwappu_bot" target="_blank" rel="noopener noreferrer">Telegram Bot</a></li>
                    <li><a href="#">Mini App</a></li>
                    <li><a href="#">SDK</a></li>
                    <li><a href="#">MCP Server</a></li>
                    <li><a href="#">REST API</a></li>
                  </ul>
                </div>
                <div>
                  <h3 className="sc-footer__heading">Chains</h3>
                  <ul className="sc-footer__list">
                    <li><span>Ethereum</span></li>
                    <li><span>Base</span></li>
                    <li><span>Arbitrum</span></li>
                    <li><span>Solana</span></li>
                    <li><span>Polygon</span></li>
                    <li><span>BSC</span></li>
                    <li><span>Avalanche</span></li>
                  </ul>
                </div>
                <div>
                  <h3 className="sc-footer__heading">Developers</h3>
                  <ul className="sc-footer__list">
                    <li><a href="https://docs.suwappu.bot" target="_blank" rel="noopener noreferrer">Documentation</a></li>
                    <li><a href="https://github.com/0xSoftBoi/suwappubot" target="_blank" rel="noopener noreferrer">GitHub</a></li>
                    <li><a href="#">API Reference</a></li>
                    <li><a href="#">Changelog</a></li>
                  </ul>
                </div>
                <div>
                  <h3 className="sc-footer__heading">Community</h3>
                  <ul className="sc-footer__list">
                    <li><a href="https://t.me/suwappu_bot" target="_blank" rel="noopener noreferrer">Telegram</a></li>
                    <li><a href="https://x.com/suwappubot" target="_blank" rel="noopener noreferrer">X (Twitter)</a></li>
                    <li><a href="#">Discord</a></li>
                  </ul>
                </div>
              </div>
              <div className="sc-footer__bottom">
                <span className="sc-footer__logo">Suwappu</span>
                <span className="sc-footer__copy">&copy; 2026 Suwappu. All rights reserved.</span>
              </div>
            </Reveal>
          </footer>
        </motion.div>
      )}
    </div>
  );
}
