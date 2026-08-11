import type { Metadata } from 'next';
import Navigation from '@/components/Navigation';
import SummerFooter from '@/components/SummerFooter';
import { TELEGRAM_URL } from '@/lib/links';
import stats from '@/data/stats.generated.json';
import styles from './solutions.module.css';

export const metadata: Metadata = {
  title: 'Solutions | Suwappu',
  description:
    `What you can build with the Suwappu Agent API: trading agents, portfolio agents, agent payments, and embedded wallets, across ${stats.agentApiChains} chains.`,
};

const spokes: { eyebrow: string; title: string; body: string; href: string }[] = [
  {
    eyebrow: 'For autonomous strategies',
    title: 'Trading agents',
    body: 'Quote and execute swaps across all supported chains from one key, inside the spend and slippage limits you set.',
    href: '/solutions/trading-agents',
  },
  {
    eyebrow: 'For research & rebalancing',
    title: 'Portfolio agents',
    body: 'Read live prices and cross-chain balances your agent can reason over, then execute on the same key.',
    href: '/solutions/portfolio-agents',
  },
  {
    eyebrow: 'For pay-per-call & micropayments',
    title: 'Agent payments',
    body: 'Bearer keys draw down prepaid credits today. Metered payments add an HTTP 402 challenge for agents that transact machine-to-machine.',
    href: '/solutions/agent-payments',
  },
  {
    eyebrow: "For apps that don't want to touch keys",
    title: 'Embedded wallets',
    body: 'Server-side wallets signed via Turnkey, with a policy layer that caps spend or restricts which addresses they can reach.',
    href: '/solutions/embedded-wallets',
  },
];

export default function SolutionsPage() {
  return (
    <main id="main-content" className="summer-page docs-shell institutional-page">
      <Navigation />
      <div className="summer-shell mkt-page">
        <header className="mkt-hero mkt-hero--center">
          <p className="summer-kicker">Solutions</p>
          <h1>Quote, swap, and settle on {stats.agentApiChains} chains from one API key.</h1>
          <p className="mkt-hero__lead">
            Trading, portfolio management, pay-per-call commerce, or a wallet your app never has
            to secure itself: pick the job, read how it works, and get a key.
          </p>
        </header>

        <div className={styles.grid}>
          {spokes.map((s) => (
            <a className={`sw-card-dark ${styles.card}`} href={s.href} key={s.href}>
              <p className={styles.cardEyebrow}>{s.eyebrow}</p>
              <h2 className={styles.cardTitle}>{s.title}</h2>
              <p className={styles.cardBody}>{s.body}</p>
              <span className={styles.cardLink}>Read more →</span>
            </a>
          ))}
        </div>

        <div className={styles.botLane}>
          <p>
            <strong>Not a developer?</strong>
            Everything above runs on the same execution engine behind the Suwappu Telegram bot.
            No API key, no code.
          </p>
          <a className="summer-button summer-button--secondary" href={TELEGRAM_URL} target="_blank" rel="noopener noreferrer">
            Open Telegram Bot
          </a>
        </div>

        <section className="mkt-cta">
          <h2>Pick your lane. Start in a minute.</h2>
          <div className="summer-actions summer-cta__actions">
            <a className="summer-button summer-button--primary" href="/docs/quick-start/overview">
              Get an API key
            </a>
            <a className="summer-button summer-button--secondary" href="/contact">
              Talk to us
            </a>
            <a className="summer-button summer-button--secondary" href="/pricing">See pricing</a>
          </div>
        </section>
      </div>
      <SummerFooter />
    </main>
  );
}
