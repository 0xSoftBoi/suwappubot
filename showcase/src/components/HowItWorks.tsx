'use client';

import { useRef } from 'react';
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

const STEPS = [
  {
    number: '01',
    title: 'Install the SDK',
    description:
      'One command. Your agent gets access to 15+ chains, MEV-shielded routing, and instant quotes.',
    command: 'bun add @suwappu/sdk',
    code: `import { Suwappu } from '@suwappu/sdk'

const client = new Suwappu({
  apiKey: process.env.SUWAPPU_KEY
})`,
  },
  {
    number: '02',
    title: 'Get a quote',
    description:
      'Best route across 15 chains. MEV-shielded. Gas optimized. One call returns the optimal path.',
    code: `const quote = await client.getQuote({
  fromChain: 'ethereum',
  toChain: 'base',
  fromToken: 'USDC',
  toToken: 'ETH',
  amount: '1000'
})`,
  },
  {
    number: '03',
    title: 'Execute the swap',
    description:
      'Non-custodial execution. Your agent submits the transaction and gets confirmation — all on-chain.',
    code: `const result = await client.swap(quote)

console.log(result.txHash)
// 0x3a1b...c4d2
console.log(result.status)
// 'confirmed'`,
  },
];

export default function HowItWorks() {
  const containerRef = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      gsap.utils.toArray<HTMLElement>('.step-item').forEach((item) => {
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
    <section id="how-it-works" ref={containerRef} className="py-32 md:py-40">
      <div className="max-w-7xl mx-auto px-6 lg:px-8">
        {/* Section header */}
        <p className="section-label mb-4">STEPS</p>
        <h2 className="font-serif text-4xl md:text-5xl lg:text-6xl text-zinc-50">
          How it works
        </h2>

        {/* Steps */}
        <div className="mt-20 md:mt-28 space-y-24 md:space-y-32">
          {STEPS.map((step) => (
            <div
              key={step.number}
              className="grid lg:grid-cols-2 gap-12 lg:gap-20 items-center step-item"
            >
              <div>
                <span className="text-sm font-mono text-zinc-600">
                  {step.number}
                </span>
                <h3 className="font-serif text-2xl md:text-3xl text-zinc-50 mt-2">
                  {step.title}
                </h3>
                <p className="text-lg text-zinc-400 mt-4 leading-relaxed max-w-md">
                  {step.description}
                </p>
                {step.command && (
                  <code className="inline-block mt-6 font-mono text-sm text-zinc-300 bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-2.5">
                    {step.command}
                  </code>
                )}
              </div>
              <div className="bg-zinc-900/50 border border-zinc-800/50 rounded-2xl p-8 aspect-video flex items-center justify-center">
                <pre className="font-mono text-sm text-zinc-400">
                  <code>{step.code}</code>
                </pre>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
