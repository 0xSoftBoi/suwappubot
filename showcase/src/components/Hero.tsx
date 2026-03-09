'use client';

import { useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useGSAP } from '@gsap/react';
import Terminal from './Terminal';
import { useScrollContext } from './HorizontalScroll';

gsap.registerPlugin(ScrollTrigger);

const STEPS = [
  { num: '01', label: 'Install', desc: 'bun add @suwappu/sdk' },
  { num: '02', label: 'Quote', desc: 'Get the best route across 15 chains' },
  { num: '03', label: 'Swap', desc: 'Execute on-chain in one call' },
];

export default function Hero() {
  const panelRef = useRef<HTMLElement>(null);
  const { scrollTween } = useScrollContext();

  // Entry animations — run once on mount, no dependency on scrollTween
  useGSAP(
    () => {
      if (!panelRef.current) return;

      // 1. CHARACTER-LEVEL ANIMATION for "Agent-driven"
      gsap.from('.hero-title-line .split-char', {
        y: 80,
        opacity: 0,
        rotateX: -40,
        stagger: 0.03,
        duration: 1,
        ease: 'power4.out',
        delay: 0.3,
      });

      // 2. "DEX." scales in with elastic bounce
      gsap.from('.hero-title-dex', {
        scale: 1.4,
        opacity: 0,
        duration: 1.2,
        ease: 'elastic.out(1, 0.5)',
        delay: 0.8,
      });

      // 3. Other elements stagger in
      gsap.from('.hero-anim', {
        y: 30,
        opacity: 0,
        stagger: 0.12,
        duration: 0.8,
        ease: 'power3.out',
        delay: 0.2,
      });
    },
    { scope: panelRef }
  );

  // Scroll-linked parallax — depends on scrollTween
  useGSAP(
    () => {
      if (!scrollTween || !panelRef.current) return;

      gsap.to('.hero-parallax', {
        xPercent: -20,
        ease: 'none',
        scrollTrigger: {
          trigger: panelRef.current,
          containerAnimation: scrollTween,
          start: 'left left',
          end: 'right left',
          scrub: true,
        },
      });
    },
    { scope: panelRef, dependencies: [scrollTween] }
  );

  return (
    <section
      ref={panelRef}
      id="hero"
      className="gsap-panel bg-[#07070e] relative"
    >
      {/* Noise texture overlay */}
      <div className="absolute inset-0 noise-overlay pointer-events-none z-[1]" />

      {/* Grid overlay - subtle decorative grid */}
      <div className="absolute inset-0 grid-overlay pointer-events-none opacity-[0.08]" />

      {/* Floating gradient blobs - parallax */}
      <div className="gradient-blob w-[350px] h-[350px] bg-[#ff2d78] top-[-10%] right-[10%] hero-parallax" />
      <div
        className="gradient-blob w-[280px] h-[280px] bg-[#a855f7] bottom-[5%] left-[-5%] hero-parallax"
      />

      {/* Content */}
      <div className="relative z-10 h-full flex items-center">
        <div className="max-w-[1400px] mx-auto px-8 lg:px-16 w-full grid lg:grid-cols-[1.2fr_0.8fr] gap-12 lg:gap-16 items-center">
          {/* LEFT COLUMN */}
          <div>
            {/* Section label */}
            <div className="hero-anim mb-6">
              <span className="text-xs uppercase tracking-[0.3em] text-[#ff2d78] font-display font-medium">
                Agent-Native DEX
              </span>
            </div>

            {/* Headline - character split */}
            <h1 className="hero-anim">
              <span className="block font-display font-bold text-5xl md:text-6xl lg:text-7xl xl:text-[5.5rem] leading-[0.95] text-[#e8e6e3] whitespace-nowrap">
                <span className="hero-title-line inline-block">
                  {'Agent-driven'.split('').map((char, i) => (
                    <span key={i} className="split-char inline-block">
                      {char}
                    </span>
                  ))}
                </span>
              </span>
              <span className="block font-display font-bold text-5xl md:text-6xl lg:text-7xl xl:text-[5.5rem] leading-[0.95] mt-2">
                <span className="hero-title-dex bg-clip-text text-transparent bg-gradient-to-r from-[#ff2d78] via-[#a855f7] to-[#6366f1] inline-block">
                  DEX.
                </span>
              </span>
            </h1>

            {/* Subtitle */}
            <p className="hero-anim mt-8 text-lg md:text-xl text-[#8a8a9c] leading-relaxed max-w-lg">
              Your agent installs the SDK, gets a quote, and executes the swap.
              Three calls. Any chain.
            </p>

            {/* Steps */}
            <div className="hero-anim mt-10 space-y-3">
              {STEPS.map((step) => (
                <div key={step.num} className="flex items-baseline gap-4">
                  <span className="font-mono text-xs text-[#4a4a5e]">
                    {step.num}
                  </span>
                  <span className="text-sm font-medium text-[#e8e6e3] w-16">
                    {step.label}
                  </span>
                  <span className="text-sm text-[#4a4a5e]">{step.desc}</span>
                </div>
              ))}
            </div>

            {/* CTA Buttons */}
            <div className="hero-anim mt-10 flex flex-wrap gap-4">
              <a
                href="https://t.me/suwappu_bot"
                target="_blank"
                rel="noopener noreferrer"
                className="bg-[#ff2d78] text-white rounded-full px-7 py-3 text-sm font-medium hover:bg-[#ff2d78]/90 transition-all hover:shadow-[0_0_30px_rgba(255,45,120,0.3)]"
              >
                Open @suwappu_bot
              </a>
              <button
                onClick={() => {
                  navigator.clipboard.writeText('bun add @suwappu/sdk');
                }}
                className="font-mono text-sm border border-white/[0.08] rounded-full px-7 py-3 text-[#8a8a9c] hover:border-[#ff2d78]/30 hover:text-[#e8e6e3] transition-all bg-white/[0.02]"
              >
                bun add @suwappu/sdk
              </button>
            </div>
          </div>

          {/* RIGHT COLUMN - Terminal */}
          <div className="hero-anim relative">
            {/* Glow behind terminal */}
            <div className="absolute -inset-8 bg-gradient-to-br from-[#ff2d78]/10 via-[#a855f7]/5 to-transparent rounded-3xl blur-2xl pointer-events-none" />

            {/* Terminal component */}
            <div className="relative">
              <Terminal />
              <p className="text-xs text-[#4a4a5e] mt-4 text-center font-mono">
                Watch the agent work
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
