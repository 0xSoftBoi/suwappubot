import type { Metadata } from 'next';
import Navigation from '@/components/Navigation';
import SummerFooter from '@/components/SummerFooter';
import { TELEGRAM_URL } from '@/lib/links';

const TERMINAL_URL = 'https://terminal.suwappu.bot';

export const metadata: Metadata = {
  title: 'Solutions — Suwappu',
  description:
    'What you can build and do with Suwappu: agentic swaps, cross-chain treasury, HyperLiquid perps, and sniping & alerts — across 40+ chains.',
};

const solutions = [
  {
    id: 'agents',
    eyebrow: 'For developers & agents',
    title: 'Agentic swaps',
    body: 'Give an AI agent the ability to quote, swap, and settle across 40+ chains through one REST API, a TypeScript SDK, or an MCP server — with policy guardrails so autonomous execution stays inside the limits you set.',
    points: ['Hosted MCP server + llms.txt discovery', 'Per-key slippage, spend caps & allowed pairs', 'Managed wallets or bring-your-own-keys'],
    cta: { label: 'Read the API docs', href: '/docs/api-reference/overview' },
  },
  {
    id: 'treasury',
    eyebrow: 'For teams & DAOs',
    title: 'Cross-chain treasury',
    body: 'Rebalance and move capital across chains at the best available price. Route a single intent across LiFi, CoW, OKX, 1inch, KyberSwap, Jupiter, Across, and CCTP — and schedule recurring moves with DCA.',
    points: ['Best-of-9 routing on every move', 'Scheduled DCA & limit orders', 'Portfolio view across every chain'],
    cta: { label: 'Open the terminal', href: TERMINAL_URL, external: true },
  },
  {
    id: 'perps',
    eyebrow: 'For traders',
    title: 'HyperLiquid perps',
    body: 'Fund a HyperCore account from any chain, then trade perps up to 20x with take-profit, stop-loss, and live PnL — plus HYPE staking and vaults, all without leaving the bot.',
    points: ['One-click cross-chain funding (Across / HyperUnit)', 'Perps up to 20x with TP/SL', 'Staking, vaults & TWAP orders'],
    cta: { label: 'See HyperLiquid', href: '/#hyperliquid' },
  },
  {
    id: 'sniping',
    eyebrow: 'For degens',
    title: 'Sniping & alerts',
    body: 'Snipe new launches with pre-configured amounts, set price alerts, and mirror top traders. Gasless first swaps on Tempo mean onboarding costs about a tenth of a cent.',
    points: ['Launch sniping with conditional modes', 'Price alerts & copy trading', 'Gasless onboarding on Tempo'],
    cta: { label: 'Start trading', href: TELEGRAM_URL, external: true },
  },
];

export default function SolutionsPage() {
  return (
    <main className="summer-page docs-shell">
      <Navigation />
      <div className="summer-shell mkt-page">
        <header className="mkt-hero mkt-hero--center">
          <p className="summer-kicker">Solutions</p>
          <h1>One engine. Every job to be done.</h1>
          <p className="mkt-hero__lead">
            Whether you&apos;re an autonomous agent, a treasury, a perps trader, or a launch
            sniper — Suwappu routes it across 40+ chains.
          </p>
        </header>

        <div className="solutions-list">
          {solutions.map((s, i) => (
            <section className="solution-row" id={s.id} key={s.id}>
              <div className="solution-row__copy">
                <p className="summer-kicker">{s.eyebrow}</p>
                <h2>{s.title}</h2>
                <p>{s.body}</p>
                <a
                  className="summer-button summer-button--secondary"
                  href={s.cta.href}
                  {...(s.cta.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                >
                  {s.cta.label}
                </a>
              </div>
              <ul className={`solution-row__points${i % 2 ? ' solution-row__points--alt' : ''}`}>
                {s.points.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        <section className="mkt-cta">
          <h2>Pick your lane. Start in a minute.</h2>
          <div className="summer-actions summer-cta__actions">
            <a className="summer-button summer-button--primary" href={TELEGRAM_URL} target="_blank" rel="noopener noreferrer">
              Open Telegram Bot
            </a>
            <a className="summer-button summer-button--secondary" href="/pricing">See pricing</a>
          </div>
        </section>
      </div>
      <SummerFooter />
    </main>
  );
}
