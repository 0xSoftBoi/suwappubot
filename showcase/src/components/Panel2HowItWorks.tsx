'use client';

import Panel from './Panel';

const STEPS = [
  {
    number: 1,
    title: 'Tool calls',
    command: 'bun add @suwappu/sdk',
    description: 'Six tools. TypeScript. Wire it into anything.',
    icon: 'M6.75 7.5l3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0021 18V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v12a2.25 2.25 0 002.25 2.25z',
  },
  {
    number: 2,
    title: 'OpenClaw Module',
    command: 'bun add @suwappu/openclaw',
    description: 'Drop-in swap skill for OpenClaw agents.',
    icon: 'M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5',
  },
  {
    number: 3,
    title: 'Skills',
    command: 'SKILL.md',
    description: 'Skill files for swap workflows. Agents read them, act on them.',
    icon: 'M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z',
  },
];

export default function Panel2HowItWorks() {
  return (
    <Panel id="how-it-works" className="flex items-center bg-suwappu-dark-bg relative">
      <div className="max-w-6xl mx-auto px-6 w-full">
        <p className="text-center text-xs font-heading font-semibold text-suwappu-magenta uppercase tracking-[0.15em] mb-3">
          Get started
        </p>
        <h2 className="font-heading font-bold text-3xl md:text-4xl text-center mb-4 text-white">
          Three ways in.
        </h2>
        <p className="text-center text-suwappu-dark-text-secondary mb-12 max-w-md mx-auto">
          Pick the integration that fits your stack.
        </p>

        <div className="max-w-2xl mx-auto space-y-5">
          {STEPS.map((step, i) => (
            <div key={step.number} className="group flex gap-4 p-5 rounded-2xl hover:bg-white/5 transition-colors duration-200">
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
                <h3 className="font-heading font-semibold text-lg mb-1 text-white">{step.title}</h3>
                <code className="text-xs text-suwappu-cyan/70 bg-white/[0.04] px-2 py-0.5 rounded font-mono">
                  {step.command}
                </code>
                <p className="text-suwappu-dark-text-secondary text-sm leading-relaxed mt-2">{step.description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Panel>
  );
}
