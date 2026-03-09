'use client';

import { useRef, useState } from 'react';
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Panel from './Panel';
import { useScrollContext } from './HorizontalScroll';

gsap.registerPlugin(ScrollTrigger);

/* ---------------------------------------------------------------
   Data
   --------------------------------------------------------------- */

const TOOLS = [
  { name: 'swap', desc: 'Cross-chain token swaps across 15 chains' },
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

/* ---------------------------------------------------------------
   Component
   --------------------------------------------------------------- */

export default function InfraPanel() {
  const panelRef = useRef<HTMLDivElement>(null);
  const { scrollTween } = useScrollContext();
  const [activeTab, setActiveTab] = useState<TabKey>('swap');

  useGSAP(
    () => {
      if (!scrollTween) return;
      const ctx = gsap.context(() => {
        // 1. Section elements reveal
        gsap.from('.infra-reveal', {
          scrollTrigger: {
            trigger: panelRef.current,
            containerAnimation: scrollTween,
            start: 'left 70%',
            end: 'left 30%',
            scrub: true,
          },
          y: 40,
          opacity: 0,
          stagger: 0.08,
        });

        // 2. Tools list stagger
        gsap.from('.tool-item', {
          scrollTrigger: {
            trigger: panelRef.current,
            containerAnimation: scrollTween,
            start: 'left 60%',
            end: 'center center',
            scrub: true,
          },
          x: 20,
          opacity: 0,
          stagger: 0.03,
        });

        // 3. Counter animations — use scrub to reliably animate with containerAnimation
        document.querySelectorAll('.stat-counter').forEach((el) => {
          const htmlEl = el as HTMLElement;
          const target = parseInt(htmlEl.getAttribute('data-target') || '0');
          const counter = { val: 0 };
          gsap.to(counter, {
            val: target,
            ease: 'power2.out',
            scrollTrigger: {
              trigger: panelRef.current,
              containerAnimation: scrollTween,
              start: 'left 50%',
              end: 'left 20%',
              scrub: true,
            },
            onUpdate: () => {
              htmlEl.textContent = Math.round(counter.val).toString();
            },
          });
        });

        // 4. Parallax blob
        gsap.to('.infra-parallax', {
          xPercent: -30,
          ease: 'none',
          scrollTrigger: {
            trigger: panelRef.current,
            containerAnimation: scrollTween,
            start: 'left right',
            end: 'right left',
            scrub: true,
          },
        });
      }, panelRef);
      return () => ctx.revert();
    },
    { dependencies: [scrollTween] },
  );

  return (
    <Panel id="infra" className="bg-[#07070e] relative overflow-hidden">
      {/* Decorative blob */}
      <div className="gradient-blob w-[300px] h-[300px] bg-[#a855f7] top-[10%] right-[-5%] infra-parallax" />

      <div ref={panelRef} className="relative z-10 h-full flex items-center">
        <div className="max-w-[1400px] mx-auto px-8 lg:px-16 w-full">
          {/* Section header */}
          <div className="infra-reveal mb-12">
            <span className="text-xs uppercase tracking-[0.3em] text-[#ff2d78] font-display font-medium">
              Infrastructure
            </span>
            <h2 className="font-display font-bold text-4xl md:text-5xl lg:text-[3.5rem] text-[#e8e6e3] mt-3 leading-tight">
              13 Tools.
              <br />
              <span className="text-[#8a8a9c]">One SDK.</span>
            </h2>
            <p className="text-[#8a8a9c] text-base mt-4 max-w-md">
              Swaps, perpetual futures, prediction markets, and lending — all
              from a single TypeScript client.
            </p>
          </div>

          {/* Two-column layout */}
          <div className="grid lg:grid-cols-[1fr_300px] gap-6 items-start">
            {/* Left: Install + tabbed code */}
            <div>
              {/* Install bar */}
              <div className="infra-reveal rounded-xl border border-white/[0.06] bg-[#0e0e1a] overflow-hidden mb-5">
                <div className="flex items-center gap-2 px-4 py-2 border-b border-white/[0.04]">
                  <span className="w-2 h-2 rounded-full bg-[#ff2d78]/40" />
                  <span className="w-2 h-2 rounded-full bg-[#a855f7]/40" />
                  <span className="w-2 h-2 rounded-full bg-[#22d3ee]/40" />
                  <span className="text-[#4a4a5e] text-[10px] font-mono ml-2">
                    terminal
                  </span>
                </div>
                <div className="px-5 py-3 flex items-center justify-between">
                  <p className="font-mono text-sm">
                    <span className="text-[#4a4a5e]">$ </span>
                    <span className="text-[#e8e6e3]">
                      bun add @suwappu/sdk
                    </span>
                  </p>
                  <button
                    onClick={() =>
                      navigator.clipboard.writeText('bun add @suwappu/sdk')
                    }
                    className="text-[#4a4a5e] hover:text-[#8a8a9c] transition-colors"
                    aria-label="Copy install command"
                  >
                    <svg
                      className="w-4 h-4"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={1.5}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 01-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 011.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 00-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 01-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 00-3.375-3.375h-1.5a1.125 1.125 0 01-1.125-1.125v-1.5a3.375 3.375 0 00-3.375-3.375H9.75"
                      />
                    </svg>
                  </button>
                </div>
              </div>

              {/* Tabs */}
              <div className="infra-reveal flex gap-1 mb-4">
                {SDK_TABS.map((tab) => (
                  <button
                    key={tab.key}
                    onClick={() => setActiveTab(tab.key)}
                    className={`px-4 py-1.5 rounded-lg text-xs font-mono transition-colors ${
                      activeTab === tab.key
                        ? 'bg-white/[0.06] text-[#e8e6e3] border border-white/[0.1]'
                        : 'text-[#4a4a5e] hover:text-[#8a8a9c] border border-transparent'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* Code block */}
              <div className="infra-reveal rounded-xl border border-white/[0.06] bg-[#0a0a14] overflow-hidden">
                <div className="px-5 py-4">
                  <pre className="font-mono text-[13px] leading-[1.7] text-[#8a8a9c] overflow-x-auto whitespace-pre">
                    {SDK_EXAMPLES[activeTab]}
                  </pre>
                </div>
              </div>
            </div>

            {/* Right: Tools list + stats */}
            <div>
              <h3 className="infra-reveal font-display text-xs text-[#4a4a5e] uppercase tracking-[0.2em] mb-4">
                All Tools
              </h3>
              <div className="space-y-0 max-h-[380px] overflow-y-auto scrollbar-thin">
                {TOOLS.map((tool) => (
                  <div
                    key={tool.name}
                    className="tool-item flex items-start gap-3 py-2 border-b border-white/[0.03] last:border-0"
                  >
                    <code className="font-mono text-[11px] text-[#22d3ee]/70 whitespace-nowrap mt-0.5 shrink-0">
                      {tool.name}
                    </code>
                    <p className="text-[#4a4a5e] text-[11px] leading-snug">
                      {tool.desc}
                    </p>
                  </div>
                ))}
              </div>

              {/* Stats */}
              <div className="infra-reveal grid grid-cols-3 gap-3 mt-6 pt-4 border-t border-white/[0.06]">
                <div className="text-center">
                  <p
                    className="stat-counter font-display font-bold text-2xl text-[#e8e6e3]"
                    data-target="15"
                  >
                    0
                  </p>
                  <p className="text-[10px] text-[#4a4a5e] uppercase tracking-wider">
                    chains
                  </p>
                </div>
                <div className="text-center">
                  <p
                    className="stat-counter font-display font-bold text-2xl text-[#e8e6e3]"
                    data-target="9"
                  >
                    0
                  </p>
                  <p className="text-[10px] text-[#4a4a5e] uppercase tracking-wider">
                    routers
                  </p>
                </div>
                <div className="text-center">
                  <p
                    className="stat-counter font-display font-bold text-2xl text-[#e8e6e3]"
                    data-target="13"
                  >
                    0
                  </p>
                  <p className="text-[10px] text-[#4a4a5e] uppercase tracking-wider">
                    tools
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Panel>
  );
}
