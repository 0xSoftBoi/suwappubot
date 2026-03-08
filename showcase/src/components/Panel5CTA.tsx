'use client';

import dynamic from 'next/dynamic';
import Panel from './Panel';
import { useScrollContext } from './HorizontalScroll';

const SakuraPetal3D = dynamic(() => import('./SakuraPetal3D'), {
  ssr: false,
  loading: () => null,
});

export default function Panel5CTA() {
  const { progressRef } = useScrollContext();
  return (
    <Panel id="cta" className="flex items-center justify-center bg-suwappu-dark-bg relative overflow-hidden">
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[400px] rounded-full bg-suwappu-magenta/5 blur-3xl" />
      <div className="absolute inset-0 pointer-events-none z-[1] hidden lg:block opacity-50">
        <SakuraPetal3D variant="shower" progressRef={progressRef} />
      </div>

      <div className="relative z-10 max-w-2xl mx-auto text-center px-6 w-full">
        <h2 className="font-heading font-bold text-3xl md:text-4xl mb-6 text-white">
          Ship something.
        </h2>
        <div className="inline-block bg-white/[0.04] border border-white/[0.08] rounded-xl px-6 py-3 mb-8">
          <code className="text-suwappu-cyan/80 text-sm font-mono">
            bun add @suwappu/sdk
          </code>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-4">
          <a
            href="https://t.me/suwappu_bot"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 btn-suwappu bg-suwappu-gradient text-white font-heading font-semibold px-8 py-3.5 rounded-suwappu-pill shadow-suwappu-button hover:shadow-suwappu-button-hover transition-shadow"
          >
            <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="currentColor">
              <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
            </svg>
            Open @suwappu_bot
          </a>
          <a
            href="https://docs.suwappu.bot"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 font-mono text-sm text-suwappu-dark-text-secondary hover:text-white px-6 py-3.5 rounded-suwappu-pill border border-white/10 hover:border-white/20 transition-all"
          >
            bun add @suwappu/sdk
          </a>
        </div>

        <div className="mt-20 pt-8 border-t border-white/5">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <span className="font-heading font-bold text-sm gradient-text">Suwappu<sup className="text-white/25 font-normal text-[8px] ml-0.5">すわっぷ</sup></span>
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
