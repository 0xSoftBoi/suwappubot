import type { Metadata } from 'next';
import Navigation from '@/components/Navigation';
import SummerFooter from '@/components/SummerFooter';
import { TELEGRAM_URL } from '@/lib/links';

export const metadata: Metadata = {
  title: 'About — Suwappu',
  description:
    'Suwappu is cross-chain execution infrastructure for agents and humans — best-price swaps, HyperLiquid perps, and gasless trades across 40+ chains, from a bot, a terminal, or one API.',
};

const metrics = [
  { value: '40+', label: 'Chains' },
  { value: '9', label: 'Routers raced' },
  { value: '20x', label: 'Perps leverage' },
  { value: '$0.001', label: 'Gasless on Tempo' },
];

const principles = [
  { title: 'Best quote, not the first', body: 'Every swap races nine aggregators. You get the best execution available, not whichever route answered first.' },
  { title: 'Your keys, your call', body: 'Bring your own keys for full self-custody, or use a managed wallet with KMS-backed encryption. Either way, you set the guardrails.' },
  { title: 'Built for agents and humans', body: 'The same execution surface powers a Telegram bot, a trading terminal, an SDK, a REST API, and an MCP server. Pick the interface that fits.' },
  { title: 'Honest about status', body: 'We publish what is real and what is on the roadmap — no certifications we have not earned, no traction we cannot back up.' },
];

const surfaces = [
  { name: 'Telegram bot', desc: 'Quote, swap, snipe, run perps, and copy traders without leaving the chat.' },
  { name: 'Trading terminal', desc: 'A dense desk — charts, order books, perps, and execution in one surface.' },
  { name: 'Agent API & SDK', desc: 'Quotes, swaps, perps, and portfolios through one REST API and a TypeScript SDK.' },
  { name: 'MCP server', desc: 'Drop Suwappu into Claude, Cursor, or any MCP client as agent-callable tools.' },
];

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-card border border-white/10 bg-[var(--canvas-2)] p-6 ${className}`}>{children}</div>
  );
}

export default function AboutPage() {
  return (
    <main id="main-content" className="min-h-screen bg-[var(--canvas-0)] text-[var(--ink-0)]">
      <Navigation />
      <div className="mx-auto max-w-7xl px-6 pb-24">
        {/* ── HERO ── */}
        <header className="mx-auto max-w-2xl pt-16 pb-12 text-center md:pt-24">
          <p className="text-xs font-medium uppercase tracking-wide text-[var(--accent)]">About Suwappu</p>
          <h1 className="mt-3 text-4xl font-medium tracking-tight md:text-5xl">
            Cross-chain execution for agents and humans.
          </h1>
          <p className="mx-auto mt-5 max-w-lg text-base leading-relaxed text-[var(--ink-1)]">
            Liquidity is fragmented across dozens of chains and venues. Suwappu makes it feel
            like one — best-price swaps, HyperLiquid perps, and gasless trades across 40+
            chains, from a bot, a terminal, or a single API call.
          </p>
        </header>

        {/* ── METRICS ── */}
        <section className="grid grid-cols-2 gap-4 md:grid-cols-4" aria-label="By the numbers">
          {metrics.map((m) => (
            <div key={m.label} className="rounded-card border border-white/10 bg-[var(--canvas-2)] p-6 text-center">
              <strong className="block text-3xl font-medium tracking-tight text-[var(--ink-0)]">{m.value}</strong>
              <span className="mt-1 block text-sm text-[var(--ink-1)]">{m.label}</span>
            </div>
          ))}
        </section>

        {/* ── PRINCIPLES ── */}
        <section className="mt-20" aria-label="What we believe">
          <h2 className="text-2xl font-medium tracking-tight">What we believe</h2>
          <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-2">
            {principles.map((p) => (
              <Card key={p.title}>
                <h3 className="text-base font-medium">{p.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-[var(--ink-1)]">{p.body}</p>
              </Card>
            ))}
          </div>
        </section>

        {/* ── SURFACES ── */}
        <section className="mt-20" aria-label="Where Suwappu runs">
          <h2 className="text-2xl font-medium tracking-tight">One engine, everywhere you work</h2>
          <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-4">
            {surfaces.map((s) => (
              <Card key={s.name}>
                <h3 className="text-base font-medium">{s.name}</h3>
                <p className="mt-2 text-sm leading-relaxed text-[var(--ink-1)]">{s.desc}</p>
              </Card>
            ))}
          </div>
        </section>

        {/* ── CAREERS ── */}
        <section
          id="careers"
          className="mt-20 flex flex-col items-start gap-4 rounded-panel border border-white/10 bg-[var(--canvas-1)] p-8"
        >
          <p className="text-xs font-medium uppercase tracking-wide text-[var(--accent)]">Careers</p>
          <h2 className="text-2xl font-medium tracking-tight md:text-3xl">
            We&apos;re building the execution layer for on-chain agents.
          </h2>
          <p className="max-w-2xl text-sm leading-relaxed text-[var(--ink-1)]">
            We&apos;re a small team shipping fast across Python, TypeScript, and on-chain
            infrastructure. If routing, wallets, perps, or agent tooling is your thing, we want
            to talk — reach out through the bot or on X.
          </p>
          <a
            href={TELEGRAM_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 rounded-control bg-[var(--accent)] px-5 py-2.5 text-sm font-medium text-[#1a1108] transition-colors hover:bg-[var(--accent-hover)] active:scale-[0.98]"
          >
            Get in touch
          </a>
        </section>
      </div>
      <SummerFooter />
    </main>
  );
}
