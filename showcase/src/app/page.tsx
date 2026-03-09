'use client';

import { useState } from 'react';
import Navigation from '@/components/Navigation';
import HorizontalScroll from '@/components/HorizontalScroll';
import Hero from '@/components/Hero';
import InfraPanel from '@/components/InfraPanel';
import DemosPanel from '@/components/DemosPanel';
import CTAPanel from '@/components/CTAPanel';
import Footer from '@/components/Footer';
import StructuredData from '@/components/StructuredData';
import Analytics from '@/components/Analytics';

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

function FAQSection() {
  const [openIdx, setOpenIdx] = useState<number | null>(null);

  return (
    <section className="py-24 md:py-32 bg-[#07070e]">
      <div className="max-w-2xl mx-auto px-6 lg:px-8">
        <span className="text-xs uppercase tracking-[0.3em] text-[#a855f7] font-display font-medium">FAQ</span>
        <h2 className="font-display font-bold text-3xl md:text-4xl text-[#e8e6e3] mt-3 mb-12">
          Common questions
        </h2>

        <div className="space-y-3">
          {FAQ_ITEMS.map((item, i) => (
            <div key={i} className="border border-white/[0.06] rounded-xl overflow-hidden bg-[#0e0e1a]/50">
              <button
                onClick={() => setOpenIdx(openIdx === i ? null : i)}
                className="w-full flex items-center justify-between px-6 py-4 text-left hover:bg-white/[0.02] transition-colors"
              >
                <span className="font-medium text-sm text-[#e8e6e3]">{item.q}</span>
                <svg
                  className={`w-4 h-4 text-[#4a4a5e] transition-transform duration-300 shrink-0 ml-4 ${openIdx === i ? 'rotate-180' : ''}`}
                  fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              <div className={`overflow-hidden transition-all duration-300 ${openIdx === i ? 'max-h-40 opacity-100' : 'max-h-0 opacity-0'}`}>
                <p className="px-6 pb-4 text-sm text-[#8a8a9c] leading-relaxed">{item.a}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export default function Home() {
  return (
    <>
      <StructuredData />
      <Analytics />
      <Navigation />

      {/* Horizontal scroll — 4 panels */}
      <HorizontalScroll>
        <Hero />
        <InfraPanel />
        <DemosPanel />
        <CTAPanel />
      </HorizontalScroll>

      {/* Vertical sections after horizontal scroll */}
      <FAQSection />
      <Footer />
    </>
  );
}
