'use client';

import { useState } from 'react';
import SakuraPetals from '@/components/SakuraPetals';
import Navigation from '@/components/Navigation';
import HorizontalScroll from '@/components/HorizontalScroll';
import Hero from '@/components/Hero';
import Panel2HowItWorks from '@/components/Panel2HowItWorks';
import Panel3Features from '@/components/Panel3Features';
import PlatformDemosPanel from '@/components/PlatformDemos';
import Panel5CTA from '@/components/Panel5CTA';
import Panel from '@/components/Panel';
import StructuredData from '@/components/StructuredData';
import Analytics from '@/components/Analytics';

/* ===================================================================
   Data
   =================================================================== */

const CHAINS = [
  { name: 'Ethereum' }, { name: 'Arbitrum' }, { name: 'Optimism' },
  { name: 'Polygon' }, { name: 'Base' }, { name: 'Avalanche' },
  { name: 'BNB Chain' }, { name: 'Solana' }, { name: 'Fantom' },
  { name: 'zkSync' }, { name: 'Linea' }, { name: 'Scroll' },
  { name: 'Blast' }, { name: 'Gnosis' }, { name: 'Aurora' },
];

const TOOLS = [
  'get_quote', 'execute_swap', 'get_portfolio', 'get_prices', 'list_chains', 'list_tokens',
];

const INTEGRATIONS = [
  { name: 'TypeScript SDK', command: 'bun add @suwappu/sdk' },
  { name: 'OpenClaw Module', command: 'bun add @suwappu/openclaw' },
  { name: 'REST API', command: 'curl api.suwappu.bot/v1/quote' },
  { name: 'Skill File', command: 'SKILL.md \u2192 agent reads, acts' },
];

const WHY_POINTS = [
  'No browser, no extension, no seed phrase.',
  'Agents get quotes, execute swaps, check balances \u2014 six tools, one key.',
  'Tool calls, REST, A2A. Pick your protocol.',
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
   Chain Strip Panel — Infra
   =================================================================== */

function ChainStripPanel() {
  const doubled = [...CHAINS, ...CHAINS];

  return (
    <Panel id="chains" className="flex items-center bg-suwappu-dark-bg relative">
      <div className="max-w-6xl mx-auto px-6 w-full">
        <p className="text-center text-xs font-heading font-semibold text-suwappu-magenta uppercase tracking-[0.15em] mb-3">
          Infrastructure
        </p>
        <h2 className="font-heading font-bold text-3xl md:text-4xl text-center mb-4 text-white">
          Plug in.{' '}
          <span className="gradient-text">Swap out.</span>
        </h2>
        <p className="text-center text-suwappu-dark-text-secondary mb-10 max-w-lg mx-auto">
          Use Suwappu as a module in your agent framework. Li.Fi, Jupiter, CoW, Wormhole — we handle the routing.
        </p>

        {/* Integration cards */}
        <div className="grid sm:grid-cols-2 gap-3 max-w-2xl mx-auto mb-12">
          {INTEGRATIONS.map((int) => (
            <div
              key={int.name}
              className="group relative rounded-xl p-4 bg-white/[0.03] border border-white/[0.06] hover:border-suwappu-magenta/20 transition-all"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-heading font-semibold text-white">{int.name}</span>
                <span className="w-1.5 h-1.5 rounded-full bg-suwappu-success" />
              </div>
              <code className="text-[11px] text-suwappu-cyan/50 font-mono leading-relaxed break-all">
                {int.command}
              </code>
            </div>
          ))}
        </div>

        {/* Chain marquee */}
        <div className="overflow-hidden relative">
          <div className="absolute left-0 top-0 bottom-0 w-16 bg-gradient-to-r from-suwappu-dark-bg to-transparent z-10" />
          <div className="absolute right-0 top-0 bottom-0 w-16 bg-gradient-to-l from-suwappu-dark-bg to-transparent z-10" />

          <div className="flex gap-8 animate-marquee">
            {doubled.map((chain, i) => (
              <div key={`${chain.name}-${i}`} className="flex flex-col items-center gap-2 shrink-0">
                <div className="w-14 h-14 rounded-2xl bg-white/[0.06] border border-white/[0.08] flex items-center justify-center hover:bg-white/[0.1] transition-colors">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-suwappu-magenta/20 to-suwappu-purple/20 flex items-center justify-center text-white/60 text-xs font-heading font-bold">
                    {chain.name.slice(0, 2)}
                  </div>
                </div>
                <span className="text-[11px] text-suwappu-dark-text-muted font-medium whitespace-nowrap">
                  {chain.name}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Tool names */}
        <div className="flex flex-wrap justify-center gap-3 mt-8">
          {TOOLS.map((t) => (
            <span key={t} className="px-4 py-2 rounded-full bg-white/[0.04] border border-white/[0.06] text-xs font-mono text-suwappu-cyan/60">
              {t}
            </span>
          ))}
        </div>
      </div>
    </Panel>
  );
}

/* ===================================================================
   Why Suwappu Panel (replaces Compare)
   =================================================================== */

function WhySuwappuPanel() {
  return (
    <Panel id="compare" className="flex items-center bg-suwappu-dark-bg relative">
      <div className="max-w-3xl mx-auto px-6 w-full">
        <p className="text-center text-xs font-heading font-semibold text-suwappu-magenta uppercase tracking-[0.15em] mb-3">
          Why Suwappu
        </p>
        <h2 className="font-heading font-bold text-3xl md:text-4xl text-center mb-12 text-white">
          Built for agents, not browsers.
        </h2>

        <div className="space-y-6">
          {WHY_POINTS.map((point, i) => (
            <div
              key={i}
              className="flex items-start gap-4 p-5 rounded-2xl bg-suwappu-dark-surface border border-white/[0.06]"
            >
              <div className="shrink-0 w-8 h-8 rounded-full bg-suwappu-gradient flex items-center justify-center text-white text-sm font-heading font-bold">
                {i + 1}
              </div>
              <p className="text-suwappu-dark-text text-base leading-relaxed pt-1">
                {point}
              </p>
            </div>
          ))}
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
        <p className="text-center text-xs font-heading font-semibold text-suwappu-magenta uppercase tracking-[0.15em] mb-3">
          FAQ
        </p>
        <h2 className="font-heading font-bold text-3xl text-center mb-12 text-suwappu-dark-text">
          Common questions
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
        <span className="font-heading font-bold text-sm gradient-text">Suwappu<sup className="text-white/25 font-normal text-[8px] ml-0.5">すわっぷ</sup></span>
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

      {/* Horizontal scroll section — 7 panels */}
      <HorizontalScroll>
        <Hero />
        <ChainStripPanel />
        <Panel2HowItWorks />
        <Panel3Features />
        <PlatformDemosPanel />
        <WhySuwappuPanel />
        <Panel5CTA />
      </HorizontalScroll>

      {/* Vertical sections after horizontal scroll */}
      <FAQSection />
      <Footer />
    </>
  );
}
