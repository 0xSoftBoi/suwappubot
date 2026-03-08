'use client';

import Panel from './Panel';

const FEATURES = [
  {
    title: 'Cross-chain',
    description: 'One call. Fifteen chains. Best route wins.',
    color: 'from-suwappu-sakura-mid to-suwappu-magenta-mid',
    iconPath: 'M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5',
  },
  {
    title: 'MEV-shielded',
    description: 'CoW on EVM, Jito on Solana. Default, not optional.',
    color: 'from-suwappu-magenta to-suwappu-purple',
    iconPath: 'M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z',
  },
  {
    title: 'Non-custodial',
    description: 'Turnkey TEE. Keys never leave the enclave.',
    color: 'from-suwappu-purple to-suwappu-purple-deep',
    iconPath: 'M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z',
  },
  {
    title: 'Programmable',
    description: 'Limits, DCA, stop-loss, take-profit. Your agent sets them.',
    color: 'from-suwappu-purple-deep to-suwappu-purple',
    iconPath: 'M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z',
  },
];

export default function Panel3Features() {
  return (
    <Panel id="features" className="flex items-center bg-suwappu-dark-bg relative">
      <div className="max-w-5xl mx-auto px-6 w-full">
        <p className="text-center text-xs font-heading font-semibold text-suwappu-magenta uppercase tracking-[0.15em] mb-3">
          Capabilities
        </p>
        <h2 className="font-heading font-bold text-3xl md:text-4xl text-center mb-16 text-white">
          What it does
        </h2>

        <div className="grid sm:grid-cols-2 gap-5">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="group rounded-2xl p-7 bg-suwappu-dark-surface border border-white/[0.06] shadow-suwappu-card-dark hover:shadow-suwappu-card-dark-hover hover:border-suwappu-magenta/20 transition-all duration-300 hover:-translate-y-1"
            >
              <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${f.color} flex items-center justify-center text-white mb-5 shadow-sm group-hover:scale-105 transition-transform duration-200`}>
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d={f.iconPath} />
                </svg>
              </div>
              <h3 className="font-heading font-semibold text-lg mb-2 text-suwappu-dark-text">{f.title}</h3>
              <p className="text-suwappu-dark-text-secondary text-sm leading-relaxed">{f.description}</p>
            </div>
          ))}
        </div>
      </div>
    </Panel>
  );
}
