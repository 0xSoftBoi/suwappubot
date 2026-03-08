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

const CHAINS = [
  { name: 'Ethereum' }, { name: 'Arbitrum' }, { name: 'Optimism' },
  { name: 'Polygon' }, { name: 'Base' }, { name: 'Avalanche' },
  { name: 'BNB Chain' }, { name: 'Solana' }, { name: 'Fantom' },
  { name: 'zkSync' }, { name: 'Linea' }, { name: 'Scroll' },
  { name: 'Blast' }, { name: 'Gnosis' }, { name: 'Aurora' },
];

const COMMANDS = [
  { text: 'bun add @suwappu/sdk', label: 'SDK' },
  { text: 'bun add @suwappu/openclaw', label: 'OpenClaw' },
  { text: 't.me/suwappu_bot', label: 'Bot', href: 'https://t.me/suwappu_bot' },
  { text: 'api.suwappu.bot/v1/', label: 'REST' },
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

function InfraPanel() {
  const { progressRef } = useScrollContext();

  return (
    <Panel id="infra" className="flex items-center justify-center bg-suwappu-dark-bg relative overflow-hidden">
      {/* 3D petals scattering behind content */}
      <div className="absolute inset-0 z-[1] pointer-events-none opacity-40 hidden lg:block">
        <SakuraPetal3D variant="scatter" progressRef={progressRef} />
      </div>

      {/* Content floats over the explosion */}
      <div className="relative z-10 max-w-4xl mx-auto px-6 w-full text-center">
        <h2 className="font-heading font-bold text-5xl md:text-7xl mb-6 text-white tracking-tight">
          Plug in.<br />
          <span className="gradient-text">Swap out.</span>
        </h2>

        {/* Raw commands — no cards, just monospace lines stacked */}
        <div className="space-y-3 mb-8">
          {COMMANDS.map((cmd) => {
            const inner = (
              <span className="inline-flex items-center gap-3">
                <span className="text-white/20 text-xs font-heading uppercase tracking-widest w-16 text-right shrink-0">{cmd.label}</span>
                <span className="text-suwappu-cyan/70 font-mono text-sm md:text-base">{cmd.text}</span>
              </span>
            );
            return cmd.href ? (
              <a key={cmd.label} href={cmd.href} target="_blank" rel="noopener noreferrer" className="block hover:text-white transition-colors">
                {inner}
              </a>
            ) : (
              <div key={cmd.label} className="block">
                {inner}
              </div>
            );
          })}
        </div>

        <p className="text-white/20 text-xs font-heading uppercase tracking-[0.2em]">
          15 chains &middot; bun-native &middot; production-ready
        </p>
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
