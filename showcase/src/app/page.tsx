'use client';

import { useState } from 'react';
import Navigation from '@/components/Navigation';
import Hero from '@/components/Hero';
import HowItWorks from '@/components/HowItWorks';
import Features from '@/components/Features';
import CTASection from '@/components/CTASection';
import Footer from '@/components/Footer';
import StructuredData from '@/components/StructuredData';
import Analytics from '@/components/Analytics';

/* ===================================================================
   FAQ Section
   =================================================================== */

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
    <section className="py-32 md:py-40">
      <div className="max-w-2xl mx-auto px-6 lg:px-8">
        <p className="section-label mb-4">FAQ</p>
        <h2 className="font-serif text-4xl md:text-5xl text-zinc-50 mb-16">
          Common questions
        </h2>

        <div className="space-y-3">
          {FAQ_ITEMS.map((item, i) => (
            <div key={i} className="border border-zinc-800/50 rounded-2xl overflow-hidden">
              <button
                onClick={() => setOpenIdx(openIdx === i ? null : i)}
                className="w-full flex items-center justify-between px-6 py-5 text-left hover:bg-zinc-900/50 transition-colors"
              >
                <span className="font-medium text-sm text-zinc-50">{item.q}</span>
                <svg
                  className={`w-4 h-4 text-zinc-500 transition-transform duration-200 shrink-0 ml-4 ${openIdx === i ? 'rotate-180' : ''}`}
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
                <p className="px-6 pb-5 text-sm text-zinc-400 leading-relaxed">
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
   Page
   =================================================================== */

export default function Home() {
  return (
    <>
      <StructuredData />
      <Analytics />
      <Navigation />

      <main>
        <Hero />
        <HowItWorks />
        <Features />
        <FAQSection />
        <CTASection />
      </main>

      <Footer />
    </>
  );
}
