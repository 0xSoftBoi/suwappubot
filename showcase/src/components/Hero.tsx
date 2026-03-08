'use client';

import { useRef } from 'react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import dynamic from 'next/dynamic';
import Panel from './Panel';
import Terminal from './Terminal';
import { useScrollContext } from './HorizontalScroll';

const SakuraPetal3D = dynamic(() => import('./SakuraPetal3D'), {
  ssr: false,
  loading: () => null,
});

// ---------------------------------------------------------------------------
// Steps — how an agent uses Suwappu
// ---------------------------------------------------------------------------

const STEPS = [
  { num: '01', title: 'Install', desc: 'bun add @suwappu/sdk' },
  { num: '02', title: 'Quote', desc: 'Get the best route across 15 chains' },
  { num: '03', title: 'Swap', desc: 'Execute on-chain in one call' },
];

// ---------------------------------------------------------------------------
// Hero Panel — agent-driven DEX demo
// ---------------------------------------------------------------------------

export default function Hero() {
  const heroRef = useRef<HTMLElement>(null);
  const { progressRef } = useScrollContext();

  useGSAP(() => {
    if (!heroRef.current) return;
    const items = heroRef.current.querySelectorAll('.hero-stagger');
    gsap.fromTo(items,
      { y: 16, opacity: 0.7 },
      { y: 0, opacity: 1, stagger: 0.1, duration: 0.8, ease: 'back.out(1.4)' }
    );
  }, { scope: heroRef });

  return (
    <Panel ref={heroRef} id="hero" className="flex items-center bg-suwappu-dark-bg relative overflow-hidden pt-20 md:pt-0">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_rgba(233,30,140,0.08)_0%,_transparent_70%)]" />
      <div className="absolute inset-0 pointer-events-none z-[1] hidden lg:block opacity-40">
        <SakuraPetal3D variant="cluster" progressRef={progressRef} />
      </div>

      <div className="relative z-10 max-w-6xl mx-auto px-6 w-full">
        <div className="grid lg:grid-cols-2 gap-12 items-center">

          {/* Left — positioning + steps */}
          <div>
            <div className="hero-stagger mb-5">
              <span className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full border border-suwappu-magenta/30 bg-suwappu-magenta/5 text-xs font-heading font-semibold text-suwappu-magenta tracking-wider uppercase">
                <span className="w-1.5 h-1.5 rounded-full bg-suwappu-success animate-pulse" />
                Agent-native DEX
              </span>
            </div>

            <h1 className="hero-stagger font-heading font-bold text-4xl md:text-5xl lg:text-6xl leading-[1.08] mb-6 text-white">
              Agent-driven
              <br />
              <span className="bg-gradient-to-r from-suwappu-magenta to-suwappu-purple bg-clip-text text-transparent">
                DEX.
              </span>
            </h1>

            <p className="hero-stagger text-suwappu-dark-text-secondary max-w-md mb-10 leading-relaxed">
              Your agent installs the SDK, gets a quote, and executes the swap. Three calls. Any chain.
            </p>

            {/* Steps */}
            <div className="hero-stagger space-y-4 mb-10">
              {STEPS.map((step) => (
                <div key={step.num} className="flex items-start gap-4">
                  <span className="text-white/15 font-mono text-xs mt-0.5 shrink-0">{step.num}</span>
                  <div>
                    <span className="text-white font-heading font-semibold text-sm">{step.title}</span>
                    <span className="text-suwappu-dark-text-secondary text-sm ml-2">{step.desc}</span>
                  </div>
                </div>
              ))}
            </div>

            <div className="hero-stagger flex flex-wrap items-center gap-3">
              <a
                href="https://t.me/suwappu_bot"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 bg-gradient-to-r from-suwappu-magenta to-suwappu-purple text-white font-heading font-semibold px-8 py-3 rounded-full shadow-suwappu-button hover:shadow-suwappu-button-hover transition-shadow"
              >
                Open @suwappu_bot
              </a>
              <a
                href="https://docs.suwappu.bot"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 font-mono font-medium text-sm text-suwappu-dark-text-secondary px-6 py-3 rounded-full border border-white/20 hover:bg-white/5 hover:text-white transition-all"
              >
                bun add @suwappu/sdk
              </a>
            </div>
          </div>

          {/* Right — live terminal demo */}
          <div className="hero-stagger">
            <Terminal />
            <p className="text-white/20 text-xs mt-3 text-center font-mono">
              Watch the agent work
            </p>
          </div>

        </div>
      </div>
    </Panel>
  );
}
