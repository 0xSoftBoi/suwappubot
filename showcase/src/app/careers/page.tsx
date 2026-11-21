import type { Metadata } from 'next';
import stats from '@/data/stats.generated.json';
import SummerNav from '@/components/SummerNav';
import SummerFooter from '@/components/SummerFooter';
import { TELEGRAM_URL } from '@/lib/links';
import { Reveal, V3Section, SectionHead, Backdrop } from '@/components/v3';
import '../content-v3.css';
import styles from './careers.module.css';

export const metadata: Metadata = {
  title: 'Careers',
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
    <div className="summer-page docs-shell institutional-page v3-tone-light cv3-page">
      <SummerNav />
      <main id="main-content">
        <div className="cv3-hero">
          <Backdrop kind="mesh" />
          <Backdrop kind="grid" />
          <div className="v3-wrap cv3-hero__grid">
            <header>
              <p className="v3-kicker">Careers</p>
              <h1>Build the execution layer for <em>on-chain agents.</em></h1>
              <p className="cv3-lead">
                We&apos;re building the routing and agent layer for cross-chain DeFi: {stats.platformChains} chains,
                HyperLiquid perps, gasless on Tempo, one API. Small, senior team. High leverage.
              </p>
            </header>
            <Reveal className="cv3-art" delay={120}>
              <div className="cv3-stack" aria-hidden="true">
                {['Python', 'TypeScript', 'Solidity'].map((l, i) => (
                  <div className="cv3-stack__plate" key={l} style={{ '--i': i } as React.CSSProperties}>
                    <i>{String(i + 1).padStart(2, '0')}</i><span>{l}</span>
                  </div>
                ))}
              </div>
            </Reveal>
          </div>
        </div>

        <V3Section tone="light" className="cv3-sec" labelledBy="careers-how">
          <SectionHead kicker="Principles" title="How we work" id="careers-how" />
          <Reveal stagger className="cv3-num-grid cv3-num-grid--5">
            {principles.map((p, i) => (
              <article className="cv3-num" key={p.t}>
                <span className="cv3-num__n" aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>
                <h3>{p.t}</h3>
                <p>{p.b}</p>
              </article>
            ))}
          </Reveal>
        </V3Section>

        <V3Section tone="light" className="cv3-sec" labelledBy="careers-roles" backdrop={<Backdrop kind="glow" />}>
          <SectionHead kicker="Roles" title="Open roles" id="careers-roles" />
          <Reveal className="cv3-empty">
            <div className="cv3-empty__mark" aria-hidden="true"><span /><span /><span /></div>
            <div>
              <h3>No open roles right now.</h3>
              <p>
                We&apos;re not actively hiring against a posted req today, but we&apos;re a small
                team that grows for the right person. If routing, wallets, key management, or
                agent tooling is your thing, send a speculative note: what you&apos;d want to
                build and why Suwappu, and we&apos;ll read it and reply.
              </p>
              <a className="summer-button summer-button--primary" href={TELEGRAM_URL} target="_blank" rel="noopener noreferrer">
                Send a speculative application
              </a>
            </div>
          </Reveal>
        </V3Section>

        <V3Section tone="light" className="cv3-sec cv3-pad-bottom" labelledBy="careers-more">
          <h2 id="careers-more" className="sr-only">The team, benefits and hiring</h2>
          <Reveal stagger className="cv3-num-grid cv3-num-grid--3">
            <article className="cv3-num">
              <span className="cv3-num__tag">The team</span>
              <p>Small, senior, and remote. We bias toward slope over credentials and trust people to own their work end to end.</p>
            </article>
            <article className="cv3-num">
              <span className="cv3-num__tag">Benefits</span>
              <ul>{benefits.map((b) => <li key={b}>{b}</li>)}</ul>
            </article>
            <article className="cv3-num">
              <span className="cv3-num__tag">How we hire</span>
              <p>A short, human process: an intro conversation, a paid work trial on a real problem, and a fast decision. We reply quickly and won&apos;t leave you guessing.</p>
            </article>
          </Reveal>
          <Reveal className="cv3-steps">
            <ol aria-label="How we hire">
              {['Intro conversation', 'Paid work trial', 'Fast decision'].map((l, i, a) => (
                <li key={l} className={i === a.length - 1 ? 'is-last' : ''}><i>{String(i + 1).padStart(2, '0')}</i>{l}</li>
              ))}
            </ol>
          </Reveal>
        </V3Section>
      </main>
      <SummerFooter />
    </div>
  );
}
