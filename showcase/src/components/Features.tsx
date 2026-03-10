'use client';

import { useRef } from 'react';
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

const features = [
  {
    title: 'Cross-chain by default',
    description:
      'Ethereum, Base, Arbitrum, Polygon, Solana, BSC, Avalanche, and more. One SDK handles routing across all of them.',
  },
  {
    title: 'MEV-shielded routing',
    description:
      'Every swap is protected from sandwich attacks and front-running. Your agent gets the price it was quoted.',
  },
  {
    title: 'Non-custodial execution',
    description:
      'Keys never leave your agent. Suwappu routes the trade — your agent signs and submits.',
  },
  {
    title: 'Multi-platform access',
    description:
      'SDK, Telegram bot, MCP server, REST API. Your agent picks the interface that fits.',
  },
];

export default function Features() {
  const containerRef = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      gsap.utils.toArray<HTMLElement>('.feature-item').forEach((item) => {
        gsap.fromTo(
          item,
          { y: 40, opacity: 0 },
          {
            y: 0,
            opacity: 1,
            duration: 0.8,
            ease: 'power3.out',
            scrollTrigger: {
              trigger: item,
              start: 'top 85%',
              toggleActions: 'play none none none',
            },
          },
        );
      });
    },
    { scope: containerRef },
  );

  return (
    <section id="features" ref={containerRef} className="py-32 md:py-40">
      <div className="max-w-7xl mx-auto px-6 lg:px-8">
        <p className="section-label mb-4">FEATURES</p>
        <h2 className="font-serif text-4xl md:text-5xl lg:text-6xl text-zinc-50 max-w-2xl">
          Built for agents,
          <br />
          ready for humans
        </h2>

        <div className="mt-20 md:mt-28 space-y-20 md:space-y-28">
          {features.map((feature, i) => (
            <div
              key={i}
              className={`grid lg:grid-cols-2 gap-12 lg:gap-20 items-center feature-item ${
                i % 2 === 1 ? 'lg:[&>*:first-child]:order-2' : ''
              }`}
            >
              <div>
                <span className="text-sm font-mono text-zinc-600">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <h3 className="font-serif text-2xl md:text-3xl text-zinc-50 mt-2">
                  {feature.title}
                </h3>
                <p className="text-lg text-zinc-400 mt-4 leading-relaxed max-w-md">
                  {feature.description}
                </p>
              </div>
              <div className="bg-zinc-900/50 border border-zinc-800/50 rounded-2xl p-1 overflow-hidden">
                <div className="aspect-video rounded-xl bg-zinc-900 flex items-center justify-center relative overflow-hidden">
                  <div className="absolute inset-0 bg-gradient-to-br from-[#ffb7c5]/10 via-transparent to-[#6c3483]/10" />
                  <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#ffb7c5] via-[#c44569] to-[#6c3483] opacity-80" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
