'use client';

import { useRef } from 'react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import Terminal from './Terminal';

const STEPS = [
  { num: '01', title: 'Install', desc: 'bun add @suwappu/sdk' },
  { num: '02', title: 'Quote', desc: 'Get the best route across 15 chains' },
  { num: '03', title: 'Swap', desc: 'Execute on-chain in one call' },
];

export default function Hero() {
  const sectionRef = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      if (!sectionRef.current) return;
      const items = sectionRef.current.querySelectorAll('.hero-stagger');
      gsap.fromTo(
        items,
        { y: 30, opacity: 0 },
        {
          y: 0,
          opacity: 1,
          stagger: 0.1,
          duration: 0.8,
          ease: 'power3.out',
        }
      );
    },
    { scope: sectionRef }
  );

  return (
    <section
      ref={sectionRef}
      id="hero"
      className="min-h-screen flex items-center relative overflow-hidden"
    >
      {/* Subtle radial glow behind content */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_30%_50%,_rgba(233,30,140,0.06)_0%,_transparent_60%)] pointer-events-none" />

      <div className="max-w-7xl mx-auto px-6 lg:px-8 w-full py-32 lg:py-0">
        <div className="grid lg:grid-cols-2 gap-16 lg:gap-20 items-center">
          {/* Left column */}
          <div>
            <div className="hero-stagger">
              <span className="section-label">Agent-native DEX</span>
            </div>

            <h1 className="hero-stagger font-serif text-7xl md:text-8xl lg:text-[7rem] text-zinc-50 leading-[0.9] mt-6">
              Agent-driven
              <br />
              <span className="bg-gradient-to-r from-[#ffb7c5] via-[#e91e8c] to-[#6c3483] bg-clip-text text-transparent">
                DEX.
              </span>
            </h1>

            <p className="hero-stagger text-xl text-zinc-400 leading-relaxed mt-6 max-w-lg">
              Your agent installs the SDK, gets a quote, and executes the swap.
              Three calls. Any chain.
            </p>

            {/* Steps */}
            <div className="hero-stagger mt-10 space-y-3">
              {STEPS.map((step) => (
                <div key={step.num} className="flex items-baseline gap-4">
                  <span className="font-mono text-sm text-zinc-600 shrink-0">
                    {step.num}
                  </span>
                  <span className="text-zinc-200 font-medium">
                    {step.title}
                  </span>
                  <span className="text-zinc-500">{step.desc}</span>
                </div>
              ))}
            </div>

            {/* CTA buttons */}
            <div className="hero-stagger mt-10 flex flex-wrap gap-4">
              <a
                href="https://t.me/suwappu_bot"
                target="_blank"
                rel="noopener noreferrer"
                className="bg-zinc-50 text-zinc-950 rounded-full px-7 py-3 text-sm font-medium hover:bg-zinc-200 transition-colors"
              >
                Open @suwappu_bot
              </a>
              <a
                href="https://docs.suwappu.bot"
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-sm border border-zinc-700 rounded-full px-7 py-3 text-zinc-300 hover:border-zinc-500 hover:text-zinc-100 transition-colors"
              >
                bun add @suwappu/sdk
              </a>
            </div>
          </div>

          {/* Right column — Terminal */}
          <div className="hero-stagger relative">
            {/* Gradient glow behind terminal */}
            <div className="absolute -inset-8 bg-gradient-to-br from-[#ffb7c5]/10 via-[#e91e8c]/8 to-[#6c3483]/10 rounded-3xl blur-3xl pointer-events-none" />
            <div className="relative">
              <Terminal />
            </div>
            <p className="text-xs text-zinc-600 mt-4 text-center">
              Watch the agent work
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
