'use client';

import { useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useGSAP } from '@gsap/react';
import Panel from './Panel';
import { useScrollContext } from './HorizontalScroll';

gsap.registerPlugin(ScrollTrigger);

const STEPS = [
  {
    number: 1,
    title: 'Message the bot',
    description: 'Open @suwappu_bot in Telegram. A non-custodial wallet is created for you automatically \u2014 no seed phrase to write down.',
    icon: 'M8.625 9.75a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375m-13.5 3.01c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.184-4.183a1.14 1.14 0 01.778-.332 48.294 48.294 0 005.83-.498c1.585-.233 2.708-1.626 2.708-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z',
  },
  {
    number: 2,
    title: 'Type a swap',
    description: 'Send /s 100 USDC ETH. The bot finds the best rate across Li.Fi and Jupiter, then shows you a quote with fees included.',
    icon: 'M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5',
  },
  {
    number: 3,
    title: 'Tap confirm',
    description: 'Review the quote and hit the confirm button. The transaction goes on-chain and you get a status update when it lands.',
    icon: 'M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  },
];

const TRADITIONAL_STEPS = [
  'Open browser',
  'Install extension',
  'Connect wallet',
  'Approve token',
  'Set slippage',
  'Confirm transaction',
];

const SUWAPPU_STEPS = ['Type swap command', 'Tap confirm'];

export default function Panel2HowItWorks() {
  const panelRef = useRef<HTMLElement>(null);
  const { scrollTween } = useScrollContext();

  useGSAP(() => {
    if (!panelRef.current) return;

    const staggerItems = panelRef.current.querySelectorAll('.hiw-stagger');
    const compareItems = panelRef.current.querySelectorAll('.hiw-compare');

    const triggerConfig = scrollTween
      ? { containerAnimation: scrollTween, trigger: panelRef.current, start: 'left 60%' }
      : { trigger: panelRef.current, start: 'top 70%' };

    gsap.from(staggerItems, {
      y: 30,
      opacity: 0,
      stagger: 0.1,
      duration: 0.6,
      ease: 'expo.out',
      scrollTrigger: triggerConfig,
    });

    gsap.from(compareItems, {
      x: 40,
      opacity: 0,
      stagger: 0.06,
      duration: 0.5,
      ease: 'expo.out',
      scrollTrigger: {
        ...triggerConfig,
        start: scrollTween ? 'left 50%' : 'top 60%',
      },
    });
  }, { scope: panelRef, dependencies: [scrollTween] });

  return (
    <Panel ref={panelRef} id="how-it-works" className="flex items-center bg-suwappu-dark-bg relative">
      <div className="max-w-6xl mx-auto px-6 w-full">
        <p className="hiw-stagger text-center text-xs font-heading font-semibold text-suwappu-magenta uppercase tracking-[0.15em] mb-3">
          How it works
        </p>
        <h2 className="hiw-stagger font-heading font-bold text-3xl md:text-4xl text-center mb-4">
          Three messages. That&apos;s it.
        </h2>
        <p className="hiw-stagger text-center text-suwappu-dark-text-secondary mb-12 max-w-md mx-auto">
          No wallet setup, no app store, no seed phrases.
        </p>

        <div className="grid lg:grid-cols-2 gap-16 items-start">
          {/* Left — Steps */}
          <div className="space-y-5">
            {STEPS.map((step, i) => (
              <div key={step.number} className="hiw-stagger group flex gap-4 p-5 rounded-2xl hover:bg-white/5 transition-colors duration-200">
                <div className="shrink-0 relative">
                  <div className="w-11 h-11 rounded-xl bg-suwappu-gradient flex items-center justify-center text-white shadow-suwappu-button">
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d={step.icon} />
                    </svg>
                  </div>
                  {i < STEPS.length - 1 && (
                    <div className="absolute top-full left-1/2 -translate-x-1/2 w-px h-5 bg-gradient-to-b from-white/20 to-transparent" />
                  )}
                </div>
                <div>
                  <span className="text-[10px] font-heading font-bold text-suwappu-magenta/50 uppercase tracking-wider">
                    Step {step.number}
                  </span>
                  <h3 className="font-heading font-semibold text-lg mb-1">{step.title}</h3>
                  <p className="text-suwappu-dark-text-secondary text-sm leading-relaxed">{step.description}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Right — Comparison */}
          <div className="space-y-6">
            <div>
              <p className="text-xs font-heading font-semibold text-suwappu-dark-text-muted uppercase tracking-[0.12em] mb-3">
                Traditional DEX
              </p>
              <div className="space-y-2">
                {TRADITIONAL_STEPS.map((step, i) => (
                  <div
                    key={step}
                    className="hiw-compare flex items-center gap-3 px-4 py-2.5 rounded-xl bg-white/[0.03] border border-white/[0.04]"
                  >
                    <span className="shrink-0 w-6 h-6 rounded-full bg-white/[0.06] text-suwappu-dark-text-muted flex items-center justify-center text-[11px] font-heading font-bold">
                      {i + 1}
                    </span>
                    <span className="text-sm text-suwappu-dark-text-muted">{step}</span>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <p className="text-xs font-heading font-semibold text-suwappu-magenta uppercase tracking-[0.12em] mb-3">
                Suwappu
              </p>
              <div className="space-y-2">
                {SUWAPPU_STEPS.map((step, i) => (
                  <div
                    key={step}
                    className="hiw-compare flex items-center gap-3 px-4 py-3 rounded-xl border border-suwappu-magenta/20 bg-gradient-to-r from-suwappu-magenta/[0.08] to-suwappu-purple/[0.06] shadow-suwappu-glow-magenta"
                  >
                    <span className="shrink-0 w-6 h-6 rounded-full bg-suwappu-gradient text-white flex items-center justify-center text-[11px] font-heading font-bold">
                      {i + 1}
                    </span>
                    <span className="text-sm font-medium text-suwappu-dark-text">{step}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="text-center pt-2">
              <span className="inline-block text-xs font-heading font-bold text-suwappu-magenta bg-suwappu-magenta/10 px-4 py-1.5 rounded-full">
                6 steps vs 2 steps
              </span>
            </div>
          </div>
        </div>
      </div>
    </Panel>
  );
}
