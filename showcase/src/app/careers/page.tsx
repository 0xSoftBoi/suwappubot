import type { Metadata } from 'next';
import Navigation from '@/components/Navigation';
import SummerFooter from '@/components/SummerFooter';
import { TELEGRAM_URL } from '@/lib/links';

export const metadata: Metadata = {
  title: 'Careers — Suwappu',
  description:
    'We’re building the routing and agent layer for cross-chain DeFi. Small, senior team. If routing, wallets, perps, or agent tooling is your thing, let’s talk.',
};

const principles = [
  { t: 'Ship to mainnet weekly', b: 'We move fast and put real things in front of real users. Momentum compounds.' },
  { t: 'Money-path code gets adversarial review', b: 'Anything that touches funds is reviewed like it can lose money — because it can.' },
  { t: 'Small team, high leverage', b: 'Every hire is senior and high-trust. We do more with fewer people, on purpose.' },
  { t: 'Build in public', b: 'We write up what we ship and how it works. Substance over hype.' },
  { t: 'Own the swap path', b: 'If you build it, you’re on call for it. Reliability is a feature, not an afterthought.' },
];

// NOTE: replace these with the real open roles + your ATS links before launch.
const roles = [
  { team: 'Protocol & swap engineering', title: 'Senior Engineer — Routing & Execution', location: 'Remote' },
  { team: 'Agent & API', title: 'Engineer — Agent API / MCP', location: 'Remote' },
  { team: 'Infrastructure', title: 'Engineer — Wallets & Key Management', location: 'Remote' },
];

const benefits = [
  'Competitive salary + meaningful equity',
  'Fully remote, async-friendly',
  'Real ownership of the surfaces you build',
  'Top-tier hardware and tools',
];

export default function CareersPage() {
  return (
    <main className="summer-page docs-shell">
      <Navigation />
      <div className="summer-shell mkt-page">
        <header className="mkt-hero mkt-hero--center">
          <p className="summer-kicker">Careers</p>
          <h1>Build the execution layer for on-chain agents.</h1>
          <p className="mkt-hero__lead">
            We&apos;re building the routing and agent layer for cross-chain DeFi — 40+ chains,
            HyperLiquid perps, gasless on Tempo, one API. Small, senior team. High leverage.
          </p>
        </header>

        <section className="about-block" aria-label="How we work">
          <h2 className="mkt-h2">How we work</h2>
          <div className="careers-principles">
            {principles.map((p) => (
              <article className="careers-principle" key={p.t}>
                <h3>{p.t}</h3>
                <p>{p.b}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="about-block" aria-label="Open roles">
          <h2 className="mkt-h2">Open roles</h2>
          <div className="careers-roles">
            {roles.map((r) => (
              <a className="careers-role" href={TELEGRAM_URL} target="_blank" rel="noopener noreferrer" key={r.title}>
                <div>
                  <span className="careers-role__team">{r.team}</span>
                  <strong>{r.title}</strong>
                </div>
                <span className="careers-role__loc">{r.location}</span>
                <span className="careers-role__apply">Apply →</span>
              </a>
            ))}
          </div>

          <div className="careers-escape">
            <h3>Don&apos;t see your role?</h3>
            <p>
              We&apos;re always looking for exceptional people working on cross-chain
              infrastructure, agents, or market plumbing. Tell us what you&apos;d build and
              why you&apos;re excited about Suwappu.
            </p>
            <a className="summer-button summer-button--primary" href={TELEGRAM_URL} target="_blank" rel="noopener noreferrer">
              Pitch us a role
            </a>
          </div>
        </section>

        <section className="careers-extra">
          <div className="careers-extra__col">
            <h3>The team</h3>
            <p>Small, senior, and remote. We bias toward slope over credentials and trust people to own their work end to end.</p>
          </div>
          <div className="careers-extra__col">
            <h3>Benefits</h3>
            <ul>
              {benefits.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          </div>
          <div className="careers-extra__col">
            <h3>How we hire</h3>
            <p>A short, human process: an intro conversation, a paid work trial on a real problem, and a fast decision. We reply quickly and won&apos;t leave you guessing.</p>
          </div>
        </section>
      </div>
      <SummerFooter />
    </main>
  );
}
