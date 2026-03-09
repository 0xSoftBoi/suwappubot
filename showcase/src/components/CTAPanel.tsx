'use client';

import { useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useGSAP } from '@gsap/react';
import Panel from './Panel';
import { useScrollContext } from './HorizontalScroll';

gsap.registerPlugin(ScrollTrigger);

export default function CTAPanel() {
  const panelRef = useRef<HTMLElement>(null);
  const { scrollTween } = useScrollContext();

  useGSAP(
    () => {
      if (!scrollTween || !panelRef.current) return;

      const ctx = gsap.context(() => {
        // 1. Headline scales down from larger size (dramatic entrance)
        gsap.from('.cta-headline', {
          scrollTrigger: {
            trigger: panelRef.current,
            containerAnimation: scrollTween,
            start: 'left 70%',
            end: 'left 20%',
            scrub: true,
          },
          scale: 1.3,
          opacity: 0,
          filter: 'blur(8px)',
        });

        // 2. Content fades up
        gsap.from('.cta-content', {
          scrollTrigger: {
            trigger: panelRef.current,
            containerAnimation: scrollTween,
            start: 'left 50%',
            end: 'center center',
            scrub: true,
          },
          y: 30,
          opacity: 0,
          stagger: 0.08,
        });

        // 3. Background glow intensifies
        gsap.fromTo(
          '.cta-glow',
          { opacity: 0.1, scale: 0.8 },
          {
            scrollTrigger: {
              trigger: panelRef.current,
              containerAnimation: scrollTween,
              start: 'left 80%',
              end: 'center center',
              scrub: true,
            },
            opacity: 0.35,
            scale: 1.2,
          },
        );
      }, panelRef);

      return () => ctx.revert();
    },
    { dependencies: [scrollTween] },
  );

  return (
    <Panel id="cta" className="bg-[#07070e] relative overflow-hidden">
      <div ref={panelRef as React.RefObject<HTMLDivElement>} className="w-screen h-screen relative">
        {/* Dramatic gradient background that intensifies */}
        <div className="absolute inset-0">
          <div className="absolute inset-0 bg-gradient-to-br from-[#ff2d78]/[0.03] via-transparent to-[#a855f7]/[0.03]" />
          <div className="gradient-blob w-[600px] h-[600px] bg-[#ff2d78] top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 cta-glow" />
        </div>

        {/* Grid overlay */}
        <div className="absolute inset-0 grid-overlay pointer-events-none opacity-20" />

        <div className="relative z-10 h-full flex flex-col items-center justify-center text-center px-8">
          {/* Big headline */}
          <h2 className="cta-headline font-display font-bold text-4xl md:text-5xl lg:text-6xl xl:text-7xl text-[#e8e6e3] leading-[1.05] max-w-3xl">
            Your next swap is
            <br />
            <span className="bg-clip-text text-transparent bg-gradient-to-r from-[#ff2d78] via-[#a855f7] to-[#6366f1]">
              one line away
            </span>
          </h2>

          {/* Subtitle */}
          <p className="cta-content mt-6 text-lg text-[#8a8a9c] max-w-xl leading-relaxed">
            Install the SDK, connect your agent, and start swapping across 15+ chains in minutes.
          </p>

          {/* Code snippet */}
          <div className="cta-content mt-8">
            <code className="font-mono text-sm text-[#22d3ee] bg-[#0e0e1a] border border-white/[0.06] rounded-xl px-6 py-3 inline-block">
              bun add @suwappu/sdk
            </code>
          </div>

          {/* CTA buttons */}
          <div className="cta-content mt-8 flex flex-col sm:flex-row gap-4">
            <a
              href="https://t.me/suwappu_bot"
              target="_blank"
              rel="noopener noreferrer"
              className="bg-[#ff2d78] text-white rounded-full px-8 py-3.5 text-sm font-medium hover:bg-[#ff2d78]/90 transition-all hover:shadow-[0_0_40px_rgba(255,45,120,0.3)] inline-flex items-center justify-center"
            >
              Open @suwappu_bot
            </a>
            <a
              href="https://docs.suwappu.bot"
              target="_blank"
              rel="noopener noreferrer"
              className="border border-white/[0.08] text-[#8a8a9c] rounded-full px-8 py-3.5 text-sm font-medium hover:border-[#ff2d78]/30 hover:text-[#e8e6e3] transition-all bg-white/[0.02] inline-flex items-center justify-center"
            >
              Read the docs
            </a>
          </div>

          {/* Mini footer inside the CTA panel */}
          <div className="cta-content mt-16 flex items-center gap-6 text-xs text-[#4a4a5e]">
            <a href="https://t.me/suwappu_bot" className="hover:text-[#8a8a9c] transition-colors">
              @suwappu_bot
            </a>
            <span>&middot;</span>
            <a href="https://docs.suwappu.bot" className="hover:text-[#8a8a9c] transition-colors">
              Docs
            </a>
            <span>&middot;</span>
            <a href="/llms.txt" className="hover:text-[#8a8a9c] transition-colors font-mono">
              llms.txt
            </a>
            <span>&middot;</span>
            <span>&copy; 2026 Suwappu</span>
          </div>
        </div>
      </div>
    </Panel>
  );
}
