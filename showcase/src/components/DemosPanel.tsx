'use client';

import { useRef } from 'react';
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Panel from './Panel';
import { useScrollContext } from './HorizontalScroll';

gsap.registerPlugin(ScrollTrigger);

/* ---------------------------------------------------------------
   Data
   --------------------------------------------------------------- */

const STEPS = [
  {
    number: '01',
    color: '#ff2d78',
    title: 'Install',
    description: 'One command. Your agent connects to 15 chains.',
    code: `$ bun add @suwappu/sdk
\u2713 installed @suwappu/sdk@0.1.0`,
    codeColor: 'text-[#22d3ee]/80',
  },
  {
    number: '02',
    color: '#a855f7',
    title: 'Quote',
    description: 'Best route. MEV-shielded. Gas optimized.',
    code: `const quote = await client
  .getQuote({
    from: 'USDC',
    to: 'ETH',
    chain: 'base',
    amount: '1000'
  })`,
    codeColor: 'text-[#8a8a9c]',
  },
  {
    number: '03',
    color: '#6366f1',
    title: 'Swap',
    description: 'Non-custodial. On-chain. Confirmed.',
    code: `const tx = await client.swap(quote)
// tx.hash: 0x3a1b...c4d2
// tx.status: 'confirmed'`,
    codeColor: 'text-[#8a8a9c]',
  },
];

/* ---------------------------------------------------------------
   Component
   --------------------------------------------------------------- */

export default function DemosPanel() {
  const panelRef = useRef<HTMLDivElement>(null);
  const { scrollTween } = useScrollContext();

  useGSAP(
    () => {
      if (!scrollTween) return;
      const ctx = gsap.context(() => {
        // 1. Section header reveal
        gsap.from('.demos-reveal', {
          scrollTrigger: {
            trigger: panelRef.current,
            containerAnimation: scrollTween,
            start: 'left 75%',
            end: 'left 40%',
            scrub: true,
          },
          y: 30,
          opacity: 0,
          stagger: 0.1,
        });

        // 2. Step cards scale up and fade in with stagger
        gsap.from('.step-card', {
          scrollTrigger: {
            trigger: panelRef.current,
            containerAnimation: scrollTween,
            start: 'left 60%',
            end: 'center center',
            scrub: true,
          },
          scale: 0.85,
          y: 60,
          opacity: 0,
          stagger: 0.1,
          transformOrigin: 'center bottom',
        });

        // 3. Parallax blob
        gsap.to('.demos-parallax', {
          xPercent: -25,
          yPercent: -15,
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
    <Panel id="demos" className="bg-[#0a0a12] relative overflow-hidden">
      {/* Decorative blob */}
      <div className="gradient-blob w-[400px] h-[400px] bg-[#6366f1] bottom-[10%] left-[-5%] demos-parallax" />

      <div ref={panelRef} className="relative z-10 h-full flex items-center">
        <div className="max-w-[1400px] mx-auto px-8 lg:px-16 w-full">
          {/* Section header */}
          <div className="demos-reveal mb-16">
            <span className="text-xs uppercase tracking-[0.3em] text-[#a855f7] font-display font-medium">
              How It Works
            </span>
            <h2 className="font-display font-bold text-4xl md:text-5xl lg:text-[3.5rem] text-[#e8e6e3] mt-3">
              Install. Quote. Swap.
            </h2>
          </div>

          {/* Three steps in a row */}
          <div className="grid md:grid-cols-3 gap-6 lg:gap-8">
            {STEPS.map((step) => (
              <div key={step.number} className="step-card group">
                <div className="p-6 rounded-2xl border border-white/[0.06] bg-[#0e0e1a]/80 backdrop-blur-sm h-full">
                  <div className="flex items-center gap-3 mb-4">
                    <span
                      className="font-mono text-xs"
                      style={{ color: step.color }}
                    >
                      {step.number}
                    </span>
                    <div
                      className="h-px flex-1"
                      style={{
                        background: `linear-gradient(to right, ${step.color}4d, transparent)`,
                      }}
                    />
                  </div>
                  <h3 className="font-display font-bold text-xl text-[#e8e6e3] mb-2">
                    {step.title}
                  </h3>
                  <p className="text-sm text-[#8a8a9c] mb-5 leading-relaxed">
                    {step.description}
                  </p>
                  <div className="rounded-lg bg-[#07070e] border border-white/[0.04] p-4">
                    <pre
                      className={`font-mono text-xs ${step.codeColor} whitespace-pre`}
                    >
                      {step.code}
                    </pre>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Panel>
  );
}
