'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import SakuraPetals from '@/components/SakuraPetals';
import Navigation from '@/components/Navigation';
import HorizontalScroll, { useScrollContext } from '@/components/HorizontalScroll';
import Hero from '@/components/Hero';
import PlatformDemosPanel from '@/components/PlatformDemos';
import Panel5CTA from '@/components/Panel5CTA';
import Panel from '@/components/Panel';
import StructuredData from '@/components/StructuredData';
import Analytics from '@/components/Analytics';

const SakuraPetal3D = dynamic(() => import('@/components/SakuraPetal3D'), {
  ssr: false,
  loading: () => null,
});

/* ===================================================================
   Data
   =================================================================== */

const TOOLS = [
  { name: 'get_quote', desc: 'Best swap route for a token pair on any chain.' },
  { name: 'execute_swap', desc: 'Execute a previously quoted swap on-chain.' },
  { name: 'get_portfolio', desc: 'Wallet balances across all connected chains.' },
  { name: 'get_prices', desc: 'Current token prices in USD.' },
  { name: 'list_chains', desc: 'All supported chains and their status.' },
  { name: 'list_tokens', desc: 'Popular tokens available on a chain.' },
  { name: 'perps.markets', desc: 'Hyperliquid perpetual futures markets and prices.' },
  { name: 'perps.quote', desc: 'Quote a leveraged long or short position.' },
  { name: 'perps.positions', desc: 'Open positions with unrealized PnL.' },
  { name: 'predict.markets', desc: 'Polymarket prediction markets with live odds.' },
  { name: 'predict.market', desc: 'Deep dive into a specific prediction market.' },
  { name: 'lend.markets', desc: 'Morpho lending markets with APY on Base.' },
  { name: 'lend.market', desc: 'Lending market details — oracle, IRM, rates.' },
];

const FAQ_ITEMS = [
  {
    q: 'Is it custodial?',
    a: 'No. Turnkey TEE hardware. Keys never leave the enclave. Users can export anytime.',
  },
  {
    q: 'How do I authenticate?',
    a: 'Register via /v1/agent/register. You get an API key. Pass it as SUWAPPU_API_KEY.',
  },
  {
    q: 'What chains?',
    a: 'Ethereum, Arbitrum, Base, Optimism, Polygon, Avalanche, BNB, Solana, and 7 more.',
  },
  {
    q: 'Can I use it in production?',
    a: 'Yes. Same infrastructure that powers @suwappu_bot. bun add, set your API key, ship.',
  },
];

/* ===================================================================
   Infra Panel — integrations + chain marquee + 3D petals
   =================================================================== */

function CopyButton() {
  const [copied, setCopied] = useState(false);

  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText('bun add @suwappu/sdk');
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className="text-xs text-white/40 hover:text-white/70 transition-colors font-mono px-3 py-1 border border-white/10 rounded hover:border-white/20"
    >
      {copied ? 'Copied!' : 'Copy'}
    </button>
  );
}

function InfraPanel() {
  const { progressRef } = useScrollContext();

  return (
    <Panel id="infra" className="flex items-center justify-center bg-suwappu-dark-bg relative overflow-hidden">
      {/* 3D petals scattering behind content */}
      <div className="absolute inset-0 z-[1] pointer-events-none opacity-40 hidden lg:block">
        <SakuraPetal3D variant="scatter" progressRef={progressRef} />
      </div>

      {/* Two-column layout */}
      <div className="relative z-10 max-w-5xl mx-auto px-6 w-full">
        <div className="grid lg:grid-cols-2 gap-16 items-start">

          {/* Left — pitch + terminal */}
          <div>
            <p className="text-suwappu-dark-text-secondary text-sm leading-relaxed mb-8 max-w-sm">
              Give your agent direct access to cross-chain swaps — get quotes, execute trades, and check balances across 15 chains.
            </p>

            {/* Terminal block */}
            <div className="rounded-xl border border-white/[0.06] bg-[#1a1b2e] overflow-hidden mb-4">
              <div className="flex items-center gap-2 px-4 py-3 border-b border-white/[0.04]">
                <span className="w-2.5 h-2.5 rounded-full bg-white/10" />
                <span className="w-2.5 h-2.5 rounded-full bg-white/10" />
                <span className="w-2.5 h-2.5 rounded-full bg-white/10" />
                <span className="text-white/20 text-[10px] font-mono ml-2">terminal</span>
              </div>
              <div className="px-5 py-4">
                <p className="font-mono text-sm">
                  <span className="text-white/30">$ </span>
                  <span className="text-white">bun add @suwappu/sdk</span>
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <span className="text-white/30 text-xs">One line to swap.</span>
              <CopyButton />
            </div>

            <p className="text-white/20 text-xs mt-6 leading-relaxed max-w-xs">
              Set <code className="text-suwappu-cyan/50 font-mono">SUWAPPU_API_KEY</code> and your agent connects automatically — no manual setup needed.
            </p>
          </div>

          {/* Right — tools reference */}
          <div className="space-y-6 lg:pt-2">
            {TOOLS.map((tool) => (
              <div key={tool.name}>
                <h3 className="font-heading font-semibold text-sm text-white mb-1">
                  {tool.name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                </h3>
                <p className="text-suwappu-dark-text-secondary text-sm leading-relaxed">
                  {tool.desc}
                </p>
              </div>
            ))}
          </div>

        </div>
      </div>
    </Panel>
  );
}

/* ===================================================================
   FAQ Section (vertical, after horizontal scroll)
   =================================================================== */

function FAQSection() {
  const [openIdx, setOpenIdx] = useState<number | null>(null);

  return (
    <section className="bg-suwappu-dark-bg py-24 px-6">
      <div className="max-w-2xl mx-auto">
        <h2 className="font-heading font-bold text-2xl text-center mb-10 text-suwappu-dark-text">
          FAQ
        </h2>

        <div className="space-y-3">
          {FAQ_ITEMS.map((item, i) => (
            <div key={i} className="border border-white/5 rounded-2xl overflow-hidden">
              <button
                onClick={() => setOpenIdx(openIdx === i ? null : i)}
                className="w-full flex items-center justify-between px-6 py-5 text-left hover:bg-white/[0.02] transition-colors"
              >
                <span className="font-heading font-semibold text-sm text-suwappu-dark-text">{item.q}</span>
                <svg
                  className={`w-4 h-4 text-suwappu-dark-text-muted transition-transform duration-200 shrink-0 ml-4 ${openIdx === i ? 'rotate-180' : ''}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              <div
                className={`overflow-hidden transition-all duration-300 ${
                  openIdx === i ? 'max-h-40 opacity-100' : 'max-h-0 opacity-0'
                }`}
              >
                <p className="px-6 pb-5 text-sm text-suwappu-dark-text-secondary leading-relaxed">
                  {item.a}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ===================================================================
   Footer
   =================================================================== */

function Footer() {
  return (
    <footer className="bg-suwappu-dark-bg border-t border-white/5 py-10 px-6">
      <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
        <span className="font-heading font-bold text-sm gradient-text">Suwappu<sup className="text-suwappu-dark-text-muted font-normal text-[8px] ml-0.5">すわっぷ</sup></span>
        <div className="flex items-center gap-6">
          <a
            href="https://t.me/suwappu_bot"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-suwappu-dark-text-muted hover:text-suwappu-dark-text-secondary transition-colors"
          >
            @suwappu_bot
          </a>
          <a
            href="https://docs.suwappu.bot"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-suwappu-dark-text-muted hover:text-suwappu-dark-text-secondary transition-colors"
          >
            Docs
          </a>
          <a
            href="/llms.txt"
            className="text-xs text-suwappu-dark-text-muted hover:text-suwappu-dark-text-secondary transition-colors font-mono"
          >
            llms.txt
          </a>
        </div>
        <p className="text-xs text-white/25">
          &copy; {new Date().getFullYear()} Suwappu
        </p>
      </div>
    </footer>
  );
}

/* ===================================================================
   Page
   =================================================================== */

export default function Home() {
  return (
    <>
      <StructuredData />
      <Analytics />
      <SakuraPetals count={6} />
      <Navigation />

      {/* Horizontal scroll — 4 panels */}
      <HorizontalScroll>
        <Hero />
        <InfraPanel />
        <PlatformDemosPanel />
        <Panel5CTA />
      </HorizontalScroll>

      {/* Vertical sections */}
      <FAQSection />
      <Footer />
    </>
  );
}
