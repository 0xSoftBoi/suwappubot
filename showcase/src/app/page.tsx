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

const COMPARE_ROWS = [
  { feature: 'Setup time', suwappu: '10 seconds', cex: '5-10 min (KYC)', dex: '2-3 min' },
  { feature: 'Custody', suwappu: 'Non-custodial (TEE)', cex: 'Custodial', dex: 'Non-custodial' },
  { feature: 'Cross-chain', suwappu: '15 chains native', cex: 'Withdraw/deposit', dex: '1-2 chains' },
  { feature: 'MEV protection', suwappu: 'Default (CoW + Jito)', cex: 'N/A', dex: 'Optional' },
  { feature: 'Interface', suwappu: 'Chat / Mini App / iOS', cex: 'Web / Mobile', dex: 'Web only' },
  { feature: 'Order types', suwappu: 'Limit, DCA, SL, TP', cex: 'Full suite', dex: 'Swap only' },
];

const FAQ_ITEMS = [
  {
    q: 'Is it safe?',
    a: 'Yes. Wallets use Turnkey TEE hardware — private keys never leave the secure enclave. You can export your keys anytime.',
  },
  {
    q: 'What are the fees?',
    a: '0.3% per swap. No hidden fees, no subscription. Gas is paid from your wallet balance.',
  },
  {
    q: 'Which chains are supported?',
    a: 'Ethereum, Arbitrum, Optimism, Polygon, Base, Avalanche, BNB Chain, Solana, Fantom, zkSync, Linea, Scroll, Blast, Gnosis, and Aurora.',
  },
  {
    q: 'Can I use it outside Telegram?',
    a: 'Yes — WhatsApp, Discord, and iOS are all supported. Same wallet, same funds across all platforms.',
  },
  {
    q: 'Do I need to install anything?',
    a: 'No. Just open @suwappu_bot in Telegram and send /start. A wallet is created for you automatically.',
  },
];

/* ===================================================================
   Chain Strip Panel — content always visible
   =================================================================== */

function ChainStripPanel() {
  const doubled = [...CHAINS, ...CHAINS];

  return (
    <Panel id="chains" className="flex items-center bg-suwappu-dark-bg relative">
      <div className="max-w-6xl mx-auto px-6 w-full">
        <p className="text-center text-xs font-heading font-semibold text-suwappu-magenta uppercase tracking-[0.15em] mb-3">
          Multi-chain
        </p>
        <h2 className="font-heading font-bold text-3xl md:text-4xl text-center mb-4 text-white">
          Routing across{' '}
          <span className="gradient-text">15 chains</span>
        </h2>
        <p className="text-center text-suwappu-dark-text-secondary mb-12 max-w-lg mx-auto">
          One command. The bot finds the best rate across every connected chain and DEX.
        </p>

        {/* Marquee */}
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

        {/* Provider badges */}
        <div className="flex flex-wrap justify-center gap-3 mt-12">
          {['Li.Fi', 'Jupiter', 'CoW Protocol', 'Socket', '1inch', 'Wormhole', 'CCTP', 'Jito', 'Uniswap'].map((p) => (
            <span key={p} className="px-4 py-2 rounded-full bg-white/[0.04] border border-white/[0.06] text-xs font-heading font-medium text-suwappu-dark-text-secondary">
              {p}
            </span>
          ))}
        </div>
      </div>
    </Panel>
  );
}

/* ===================================================================
   Compare Panel — content always visible
   =================================================================== */

function ComparePanel() {
  return (
    <Panel id="compare" className="flex items-center bg-suwappu-dark-bg relative">
      <div className="max-w-5xl mx-auto px-6 w-full">
        <p className="text-center text-xs font-heading font-semibold text-suwappu-magenta uppercase tracking-[0.15em] mb-3">
          Compare
        </p>
        <h2 className="font-heading font-bold text-3xl md:text-4xl text-center mb-12 text-white">
          How Suwappu stacks up
        </h2>

        <div className="overflow-x-auto -mx-6 px-6">
          <table className="w-full min-w-[600px]">
            <thead>
              <tr className="border-b border-white/10">
                <th className="text-left py-4 px-4 text-sm font-heading font-medium text-suwappu-dark-text-muted" />
                <th className="text-center py-4 px-4">
                  <span className="text-sm font-heading font-bold gradient-text">Suwappu</span>
                </th>
                <th className="text-center py-4 px-4 text-sm font-heading font-medium text-suwappu-dark-text-secondary">CEX</th>
                <th className="text-center py-4 px-4 text-sm font-heading font-medium text-suwappu-dark-text-secondary">DEX Aggregator</th>
              </tr>
            </thead>
            <tbody>
              {COMPARE_ROWS.map((row) => (
                <tr key={row.feature} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                  <td className="py-4 px-4 text-sm font-medium text-suwappu-dark-text">{row.feature}</td>
                  <td className="py-4 px-4 text-center">
                    <span className="inline-block text-xs font-heading font-semibold text-suwappu-magenta bg-suwappu-magenta/10 px-3 py-1.5 rounded-full">
                      {row.suwappu}
                    </span>
                  </td>
                  <td className="py-4 px-4 text-center text-sm text-suwappu-dark-text-secondary">{row.cex}</td>
                  <td className="py-4 px-4 text-center text-sm text-suwappu-dark-text-secondary">{row.dex}</td>
                </tr>
              ))}
            </tbody>
          </table>
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
        <span className="font-heading font-bold text-sm gradient-text">Suwappu</span>
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
        <ComparePanel />
        <Panel5CTA />
      </HorizontalScroll>

      {/* Vertical sections after horizontal scroll */}
      <FAQSection />
      <Footer />
    </>
  );
}
