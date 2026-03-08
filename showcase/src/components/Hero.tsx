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
// Stats
// ---------------------------------------------------------------------------

const STATS = [
  { value: '6', label: 'Tools' },
  { value: '15', label: 'Chains' },
  { value: 'bun', label: 'Native' },
];

// ---------------------------------------------------------------------------
// Hero Panel — content always visible, gentle entrance only
// ---------------------------------------------------------------------------

export default function Hero() {
  const heroRef = useRef<HTMLElement>(null);
  const { progressRef } = useScrollContext();

  useGSAP(() => {
    if (!heroRef.current) return;
    const items = heroRef.current.querySelectorAll('.hero-stagger');
    // Gentle slide up — starts slightly offset, always visible
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
          <div>
            <div className="hero-stagger mb-5">
              <span className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full border border-suwappu-magenta/30 bg-suwappu-magenta/5 text-xs font-heading font-semibold text-suwappu-magenta tracking-wider uppercase">
                <span className="w-1.5 h-1.5 rounded-full bg-suwappu-success animate-pulse" />
                Agent-native DEX
              </span>
            </div>

            <h1 className="hero-stagger font-heading font-bold text-4xl md:text-5xl lg:text-6xl leading-[1.08] mb-6 text-white">
              One line.
              <br />
              <span className="bg-gradient-to-r from-suwappu-magenta to-suwappu-purple bg-clip-text text-transparent">
                Every chain.
              </span>
            </h1>

            <p className="hero-stagger text-lg text-suwappu-dark-text-secondary max-w-md mb-8 leading-relaxed">
              Cross-chain routing, gas abstraction, MEV protection — handled.{' '}
              <code className="text-suwappu-cyan/70 text-base">bun&nbsp;add&nbsp;@suwappu/sdk</code>{' '}
              and start building.
            </p>

            <div className="hero-stagger flex items-center gap-6 mb-8">
              {STATS.map((stat, i) => (
                <div key={stat.label} className="flex items-center gap-6">
                  {i > 0 && <div className="w-px h-8 bg-white/10" />}
                  <div className="text-center">
                    <div className="bg-gradient-to-r from-suwappu-magenta to-suwappu-purple bg-clip-text text-transparent font-heading font-bold text-2xl">
                      {stat.value}
                    </div>
                    <div className="text-white/50 text-xs font-medium uppercase tracking-wider mt-0.5">
                      {stat.label}
                    </div>
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

          <div className="hero-stagger">
            <Terminal />
          </div>
        </div>
      </div>
    </Panel>
  );
}
