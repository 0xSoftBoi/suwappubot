import type { Metadata } from 'next';
import stats from '@/data/stats.generated.json';
import Navigation from '@/components/Navigation';
import SummerFooter from '@/components/SummerFooter';
import { TELEGRAM_URL } from '@/lib/links';
import styles from './careers.module.css';

export const metadata: Metadata = {
  title: 'Careers | Suwappu',
  description:
    'We’re building the routing and agent layer for cross-chain DeFi. Small, senior team. If routing, wallets, perps, or agent tooling is your thing, let’s talk.',
};

const principles = [
  { t: 'Ship to mainnet weekly', b: 'We move fast and put real things in front of real users. Momentum compounds.' },
  { t: 'Money-path code gets adversarial review', b: 'Anything that touches funds is reviewed like it can lose money: because it can.' },
  { t: 'Small team, high leverage', b: 'Every hire is senior and high-trust. We do more with fewer people, on purpose.' },
  { t: 'Build in public', b: 'We write up what we ship and how it works. Substance over hype.' },
  { t: 'Own the swap path', b: 'If you build it, you’re on call for it. Reliability is a feature, not an afterthought.' },
];

const benefits = [
  'Competitive salary + meaningful equity',
  'Fully remote, async-friendly',
  'Real ownership of the surfaces you build',
  'Top-tier hardware and tools',
];

export default function CareersPage() {
  return (
    <main id="main-content" className="summer-page docs-shell sw-dark">
      <Navigation />
      <div className="summer-shell mkt-page">
        <header className="mkt-hero mkt-hero--center">
          <p className="summer-kicker">Careers</p>
          <h1>Build the execution layer for on-chain agents.</h1>
          <p className="mkt-hero__lead">
            We&apos;re building the routing and agent layer for cross-chain DeFi: {stats.platformChains} chains,
            HyperLiquid perps, gasless on Tempo, one API. Small, senior team. High leverage.
          </p>
        </header>

        <section className="about-block" aria-label="How we work">
          <h2 className="mkt-h2">How we work</h2>
          <div className="careers-principles">
            {principles.map((p) => (
              <article className="careers-principle" key={p.t}>
                <h3 className="sw-h3">{p.t}</h3>
                <p>{p.b}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="about-block" aria-label="Open roles">
          <h2 className="mkt-h2">Open roles</h2>
          <div className="careers-escape">
            <h3 className="sw-h3">No open roles right now.</h3>
            <p>
              We&apos;re not actively hiring against a posted req today, but we&apos;re a small
              team that grows for the right person. If routing, wallets, key management, or
              agent tooling is your thing, send a speculative note: what you&apos;d want to
              build and why Suwappu, and we&apos;ll read it and reply.
            </p>
            <a
              className={`summer-button ${styles.ghost}`}
              href={TELEGRAM_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              Send a speculative application
            </a>
          </div>
        </section>

        <section className="careers-extra">
          <div className="careers-extra__col">
            <h3 className="sw-h3">The team</h3>
            <p>Small, senior, and remote. We bias toward slope over credentials and trust people to own their work end to end.</p>
          </div>
          <div className="careers-extra__col">
            <h3 className="sw-h3">Benefits</h3>
            <ul>
              {benefits.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          </div>
          <div className="careers-extra__col">
            <h3 className="sw-h3">How we hire</h3>
            <p>A short, human process: an intro conversation, a paid work trial on a real problem, and a fast decision. We reply quickly and won&apos;t leave you guessing.</p>
          </div>
        </section>
      </div>
      <SummerFooter />
    </main>
  );
}
