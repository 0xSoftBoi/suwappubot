'use client';

import { useState } from 'react';
import SakuraPetals from '@/components/SakuraPetals';
import Navigation from '@/components/Navigation';
import HorizontalScroll from '@/components/HorizontalScroll';
import Hero from '@/components/Hero';
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

const INTEGRATIONS = [
  { name: 'SDK', command: 'bun add @suwappu/sdk' },
  { name: 'OpenClaw', command: 'bun add @suwappu/openclaw' },
  { name: 'REST', command: 'curl api.suwappu.bot/v1/quote' },
  { name: 'Skills', command: 'SKILL.md' },
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
   Infra Panel — integrations + chain marquee
   =================================================================== */

function InfraPanel() {
  const doubled = [...CHAINS, ...CHAINS];

  return (
    <Panel id="infra" className="flex items-center bg-suwappu-dark-bg relative">
      <div className="max-w-6xl mx-auto px-6 w-full">
        <h2 className="font-heading font-bold text-3xl md:text-4xl text-center mb-10 text-white">
          Plug in.{' '}
          <span className="gradient-text">Swap out.</span>
        </h2>

        {/* Integration row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 max-w-3xl mx-auto mb-14">
          {INTEGRATIONS.map((int) => (
            <div
              key={int.name}
              className="rounded-xl p-4 bg-white/[0.03] border border-white/[0.06] hover:border-suwappu-magenta/20 transition-all"
            >
              <span className="text-sm font-heading font-semibold text-white block mb-1.5">{int.name}</span>
              <code className="text-[11px] text-suwappu-cyan/50 font-mono break-all">
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
                <div className="w-12 h-12 rounded-xl bg-white/[0.06] border border-white/[0.08] flex items-center justify-center">
                  <div className="w-7 h-7 rounded-full bg-gradient-to-br from-suwappu-magenta/20 to-suwappu-purple/20 flex items-center justify-center text-white/60 text-[10px] font-heading font-bold">
                    {chain.name.slice(0, 2)}
                  </div>
                </div>
                <span className="text-[10px] text-suwappu-dark-text-muted font-medium whitespace-nowrap">
                  {chain.name}
                </span>
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
