import type { Metadata } from 'next';
import SummerNav from '@/components/SummerNav';
import SummerFooter from '@/components/SummerFooter';
import StatCountUp from './StatCountUp';
import { TELEGRAM_URL } from '@/lib/links';
import stats from '@/data/stats.generated.json';
import { Reveal, V3Section, SectionHead, Backdrop, ChainRing, RouteMap } from '@/components/v3';
import '../content-v3.css';

export const metadata: Metadata = {
  title: 'About',
  description: `Suwappu is cross-chain execution infrastructure for agents and humans: best-price swaps, HyperLiquid perps, and gasless trades across ${stats.platformChains} chains, from a bot, a terminal, or one API.`,
};

const metrics = [
  { value: String(stats.platformChains), label: 'Chains' },
  // Routing providers integrated, not raced-per-swap: they are chain-gated, so a
  // Solana trade races Jupiter while an EVM trade races the 0x/1inch/OKX cluster.
  { value: String(stats.routerCount), label: 'Routing providers' },
  { value: '20x', label: 'Perps leverage' },
  { value: '$0.001', label: 'Gasless on Tempo' },
];

const principles = [
  { title: 'Best quote, not the first', body: `We race every routing provider that supports your route: ${stats.routerCount} integrated in total, from 0x and 1inch to Jupiter on Solana and SunSwap on TRON. You get the best execution available, not whichever route answered first.` },
  { title: 'Your keys, your call', body: 'Bring your own keys for full self-custody, or use a managed wallet with KMS-backed encryption. Either way, you set the guardrails.' },
  { title: 'Built for agents and humans', body: 'The same execution surface powers a Telegram bot, a trading terminal, an SDK, a REST API, and an MCP server. Pick the interface that fits.' },
  { title: 'Honest about status', body: 'We publish what is real and what is on the roadmap: no certifications we have not earned, no traction we cannot back up.' },
];

const surfaces = [
  { name: 'Telegram bot', desc: 'Quote, swap, snipe, run perps, and copy traders without leaving the chat.' },
  { name: 'Trading terminal', desc: 'A dense desk: charts, order books, perps, and execution in one surface.' },
  { name: 'Agent API & SDK', desc: 'Quotes, swaps, perps, and portfolios through one REST API and a TypeScript SDK.' },
  { name: 'MCP server', desc: 'Drop Suwappu into Claude, Cursor, or any MCP client as agent-callable tools.' },
];

export default function AboutPage() {
  return (
    <div className="summer-page docs-shell institutional-page v3-tone-light cv3-page">
      <SummerNav />
      <main id="main-content">
        <div className="cv3-hero">
          <Backdrop kind="mesh" />
          <Backdrop kind="grid" />
          <div className="v3-wrap cv3-hero__grid">
            <header>
              <p className="v3-kicker">About Suwappu</p>
              <h1>Cross-chain execution for <em>agents</em> and humans.</h1>
              <p className="cv3-lead">
                Liquidity is fragmented across dozens of chains and venues. Suwappu makes it
                feel like one: best-price swaps, HyperLiquid perps, and gasless trades across
                {' '}{stats.platformChains} chains, from a bot, a terminal, or a single API call.
              </p>
            </header>
            <Reveal className="cv3-art" delay={120}><ChainRing /></Reveal>
          </div>
        </div>

        <div className="v3-wrap">
          <Reveal>
            <section className="cv3-stats" aria-label="By the numbers">
              {metrics.map((m) => (
                <div className="cv3-stat" key={m.label}>
                  <StatCountUp value={m.value} className="cv3-stat__v" />
                  <span className="cv3-stat__l">{m.label}</span>
                </div>
              ))}
            </section>
          </Reveal>
        </div>

        <V3Section tone="light" className="cv3-sec" labelledBy="about-believe">
          <SectionHead kicker="Principles" title="What we believe" id="about-believe" />
          <Reveal stagger className="cv3-num-grid cv3-num-grid--2">
            {principles.map((p, i) => (
              <article className="cv3-num" key={p.title}>
                <span className="cv3-num__n" aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>
                <h3>{p.title}</h3>
                <p>{p.body}</p>
              </article>
            ))}
          </Reveal>
        </V3Section>

        <V3Section tone="light" className="cv3-sec" labelledBy="about-surfaces" backdrop={<Backdrop kind="glow" />}>
          <div className="v3-split v3-split--reverse">
            <div>
              <SectionHead title="One engine, everywhere you work" id="about-surfaces" />
              <Reveal className="cv3-rows" style={{ marginTop: '1.6rem' }}>
                {surfaces.map((s, i) => (
                  <div className="cv3-row" key={s.name}>
                    <i>{String(i + 1).padStart(2, '0')}</i>
                    <strong>{s.name}</strong>
                    <span>{s.desc}</span>
                  </div>
                ))}
              </Reveal>
            </div>
            <Reveal className="cv3-art" style={{ maxWidth: 520 }}><RouteMap /></Reveal>
          </div>
        </V3Section>

        <V3Section tone="light" className="cv3-sec cv3-pad-bottom" id="careers">
          <div className="cv3-close v3-tone-dark">
            <Backdrop kind="mesh-grain" />
            <p className="v3-kicker">Careers</p>
            <h2>We&apos;re building the execution layer for on-chain agents.</h2>
            <p>
              We&apos;re a small team shipping fast across Python, TypeScript, and on-chain
              infrastructure. If routing, wallets, perps, or agent tooling is your thing,
              we want to talk: reach out through the bot or on X.
            </p>
            <div className="cv3-actions">
              <a className="summer-button summer-button--primary" href={TELEGRAM_URL} target="_blank" rel="noopener noreferrer">Get in touch</a>
            </div>
          </div>
        </V3Section>
      </main>
      <SummerFooter />
    </div>
  );
}
