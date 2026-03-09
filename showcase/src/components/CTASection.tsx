'use client';

import { useRef } from 'react';
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

export default function CTASection() {
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      if (!contentRef.current) return;

      gsap.fromTo(
        contentRef.current,
        { y: 60, opacity: 0 },
        {
          y: 0,
          opacity: 1,
          duration: 1,
          ease: 'power3.out',
          scrollTrigger: {
            trigger: containerRef.current,
            start: 'top 80%',
            end: 'top 30%',
            toggleActions: 'play none none reverse',
          },
        }
      );
    },
    { scope: containerRef }
  );

  return (
    <section
      id="get-started"
      ref={containerRef}
      className="py-32 md:py-40 relative overflow-hidden"
    >
      {/* Subtle gradient background */}
      <div className="absolute inset-0 bg-gradient-to-b from-zinc-950 via-zinc-950 to-zinc-900" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-gradient-to-br from-[#ffb7c5]/5 via-[#c44569]/5 to-[#6c3483]/5 blur-3xl" />

      <div
        ref={contentRef}
        className="max-w-4xl mx-auto px-6 lg:px-8 text-center relative z-10"
      >
        <h2 className="font-serif text-4xl md:text-5xl lg:text-6xl text-zinc-50">
          Your next swap is
          <br />
          one line away
        </h2>
        <p className="mt-6 text-lg md:text-xl text-zinc-400 max-w-2xl mx-auto leading-relaxed">
          Install the SDK, connect your agent, and start swapping across 15+
          chains in minutes.
        </p>

        {/* Code snippet */}
        <div className="mt-10 inline-block">
          <code className="font-mono text-sm text-zinc-300 bg-zinc-900 border border-zinc-800 rounded-xl px-6 py-3 block">
            bun add @suwappu/sdk
          </code>
        </div>

        {/* CTA buttons */}
        <div className="mt-10 flex flex-col sm:flex-row gap-4 justify-center">
          <a
            href="https://t.me/suwappu_bot"
            target="_blank"
            rel="noopener noreferrer"
            className="bg-zinc-50 text-zinc-950 rounded-full px-8 py-3.5 text-sm font-medium hover:bg-zinc-200 transition-colors inline-flex items-center justify-center gap-2"
          >
            Open @suwappu_bot
          </a>
          <a
            href="https://docs.suwappu.bot"
            target="_blank"
            rel="noopener noreferrer"
            className="border border-zinc-700 text-zinc-300 rounded-full px-8 py-3.5 text-sm font-medium hover:border-zinc-500 hover:text-zinc-100 transition-colors inline-flex items-center justify-center gap-2"
          >
            Read the docs
          </a>
        </div>
      </div>
    </section>
  );
}
