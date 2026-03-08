'use client';

import dynamic from 'next/dynamic';
import Panel from './Panel';
import Terminal from './Terminal';
import { useScrollContext } from './HorizontalScroll';

const SakuraPetal3D = dynamic(() => import('./SakuraPetal3D'), {
  ssr: false,
  loading: () => null,
});

export default function PlatformDemosPanel() {
  const { progressRef } = useScrollContext();

  return (
    <Panel id="demos" className="flex items-center bg-suwappu-dark-bg relative overflow-hidden">
      {/* Petals behind */}
      <div className="absolute inset-0 z-[1] opacity-25 pointer-events-none hidden lg:block">
        <SakuraPetal3D variant="shower" progressRef={progressRef} />
      </div>

      <div className="relative z-10 max-w-5xl mx-auto px-6 w-full">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          {/* Left — the actual terminal running */}
          <div className="max-w-[420px] mx-auto lg:mx-0 w-full">
            <Terminal />
          </div>

          {/* Right — what you just saw, explained */}
          <div>
            <p className="text-white/25 text-xs font-heading uppercase tracking-[0.2em] mb-4">What just happened</p>
            <h2 className="font-heading font-bold text-2xl md:text-3xl text-white mb-6 leading-tight">
              Install. Quote. Swap.<br />
              Three commands.
            </h2>
            <div className="space-y-4 text-sm text-suwappu-dark-text-secondary leading-relaxed">
              <p>
                <code className="text-suwappu-cyan/60 font-mono">bun add @suwappu/sdk</code> gives you six tools.
                Get a quote, execute the swap, check your portfolio — all from your terminal.
              </p>
              <p>
                Same API powers{' '}
                <a href="https://t.me/suwappu_bot" target="_blank" rel="noopener noreferrer" className="text-suwappu-magenta hover:text-white transition-colors">
                  @suwappu_bot
                </a>
                {' '}on Telegram, WhatsApp, Discord, and iOS. Your agent gets the same access.
              </p>
            </div>
            <div className="mt-8 flex flex-wrap gap-3">
              <a
                href="https://t.me/suwappu_bot"
                target="_blank"
                rel="noopener noreferrer"
                className="btn-suwappu inline-flex items-center gap-2 bg-suwappu-gradient text-white font-heading font-semibold px-6 py-2.5 rounded-full text-sm"
              >
                Open @suwappu_bot
              </a>
              <a
                href="https://docs.suwappu.bot"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center font-mono text-sm text-white/40 hover:text-white transition-colors"
              >
                docs.suwappu.bot &rarr;
              </a>
            </div>
          </div>
        </div>
      </div>
    </Panel>
  );
}
