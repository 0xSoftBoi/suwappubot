'use client';

import { useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useGSAP } from '@gsap/react';
import Panel from './Panel';
import { useScrollContext } from './HorizontalScroll';

gsap.registerPlugin(ScrollTrigger);

export default function Panel5CTA() {
  const panelRef = useRef<HTMLElement>(null);
  const { scrollTween } = useScrollContext();

  useGSAP(() => {
    if (!panelRef.current) return;

    const items = panelRef.current.querySelectorAll('.cta-stagger');
    const triggerConfig = scrollTween
      ? { containerAnimation: scrollTween, trigger: panelRef.current, start: 'left 60%' }
      : { trigger: panelRef.current, start: 'top 70%' };

    gsap.from(items, {
      y: 24,
      opacity: 0,
      stagger: 0.12,
      duration: 0.6,
      ease: 'expo.out',
      scrollTrigger: triggerConfig,
    });
  }, { scope: panelRef, dependencies: [scrollTween] });

  return (
    <Panel ref={panelRef} id="cta" className="flex items-center justify-center bg-suwappu-dark-bg relative overflow-hidden">
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[400px] rounded-full bg-suwappu-magenta/5 blur-3xl" />

      <div className="relative max-w-2xl mx-auto text-center px-6 w-full">
        {/* CTA */}
        <h2 className="cta-stagger font-heading font-bold text-3xl md:text-4xl mb-4">
          Open Telegram.{' '}
          <span className="gradient-text">Type /start.</span>
        </h2>
        <p className="cta-stagger text-suwappu-dark-text-secondary mb-8">
          That&apos;s the whole onboarding. Your wallet is ready in the time it takes to read this sentence.
        </p>
        <a
          href="https://t.me/suwappu_bot"
          target="_blank"
          rel="noopener noreferrer"
          className="cta-stagger inline-flex items-center gap-2 btn-suwappu bg-suwappu-gradient text-white font-heading font-semibold px-8 py-3.5 rounded-suwappu-pill shadow-suwappu-button hover:shadow-suwappu-button-hover transition-shadow"
        >
          <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="currentColor">
            <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
          </svg>
          Open @suwappu_bot
        </a>
        <div className="cta-stagger flex items-center justify-center gap-5 mt-6 text-xs text-suwappu-dark-text-secondary">
          <span>Non-custodial</span>
          <span className="w-1 h-1 rounded-full bg-suwappu-dark-text-muted" />
          <span>0.3% fee</span>
          <span className="w-1 h-1 rounded-full bg-suwappu-dark-text-muted" />
          <span>15 chains</span>
        </div>

        {/* Compact Footer */}
        <div className="cta-stagger mt-20 pt-8 border-t border-white/5">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <span className="font-heading font-bold text-sm gradient-text">Suwappu</span>
            <a
              href="https://t.me/suwappu_bot"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-white/40 hover:text-white/60 transition-colors"
            >
              @suwappu_bot
            </a>
            <p className="text-xs text-white/25">
              &copy; {new Date().getFullYear()} Suwappu
            </p>
          </div>
        </div>
      </div>
    </Panel>
  );
}
