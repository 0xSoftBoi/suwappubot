import type { Metadata } from 'next';
import Navigation from '@/components/Navigation';
import SummerFooter from '@/components/SummerFooter';
import StatCountUp from './StatCountUp';
import { TELEGRAM_URL } from '@/lib/links';
import stats from '@/data/stats.generated.json';
import styles from './about.module.css';

export const metadata: Metadata = {
  title: 'About — Suwappu',
  description: `Suwappu is cross-chain execution infrastructure for agents and humans — best-price swaps, HyperLiquid perps, and gasless trades across ${stats.platformChains} chains, from a bot, a terminal, or one API.`,
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
  { title: 'Best quote, not the first', body: `We race every routing provider that supports your route — ${stats.routerCount} integrated in total, from 0x and 1inch to Jupiter on Solana and SunSwap on TRON. You get the best execution available, not whichever route answered first.` },
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

export default function AboutPage() {
  return (
    <main id="main-content" className="summer-page docs-shell sw-dark">
      <Navigation />
      <div className="summer-shell mkt-page">
        <header className="mkt-hero mkt-hero--center">
          <p className="summer-kicker">About Suwappu</p>
          <h1>Cross-chain execution for agents and humans.</h1>
          <p className="mkt-hero__lead">
            Liquidity is fragmented across dozens of chains and venues. Suwappu makes it
            feel like one — best-price swaps, HyperLiquid perps, and gasless trades across
            {' '}{stats.platformChains} chains, from a bot, a terminal, or a single API call.
          </p>
        </header>

        <section className={styles.stats} aria-label="By the numbers">
          {metrics.map((m) => (
            <div className={styles.stat} key={m.label}>
              <StatCountUp value={m.value} className={`about-stat ${styles.statValue}`} />
              <span className={styles.statLabel}>{m.label}</span>
            </div>
          ))}
        </section>

        <section className="about-block" aria-label="What we believe">
          <h2 className="mkt-h2">What we believe</h2>
          <div className="sw-rows">
            {principles.map((p) => (
              <article className={`sw-row ${styles.row}`} key={p.title}>
                <h3 className="sw-h3">{p.title}</h3>
                <p>{p.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="about-block" aria-label="Where Suwappu runs">
          <h2 className="mkt-h2">One engine, everywhere you work</h2>
          <div className="sw-rows">
            {surfaces.map((s) => (
              <article className={`sw-row ${styles.row}`} key={s.name}>
                <h3 className="sw-h3">{s.name}</h3>
                <p>{s.desc}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="about-careers" id="careers">
          <p className="summer-kicker">Careers</p>
          <h2 className="mkt-h2">We&apos;re building the execution layer for on-chain agents.</h2>
          <p>
            We&apos;re a small team shipping fast across Python, TypeScript, and on-chain
            infrastructure. If routing, wallets, perps, or agent tooling is your thing,
            we want to talk — reach out through the bot or on X.
          </p>
          <a className="summer-button summer-button--primary" href={TELEGRAM_URL} target="_blank" rel="noopener noreferrer">
            Get in touch
          </a>
        </section>
      </div>
      <SummerFooter />
    </main>
  );
}
