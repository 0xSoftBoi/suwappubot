import type { Metadata } from 'next';
import SummerNav from '@/components/SummerNav';
import SummerFooter from '@/components/SummerFooter';
import { START, SITE_ORIGIN, SOLVE_UPDATED } from '@/data/solve';
import { Backdrop, ProblemStrip } from '@/components/v3';
import TrackedLink from '@/components/solve/TrackedLink';
import CopyCode from '@/components/solve/CopyCode';
import StartKey from '@/components/solve/StartKey';
import '../sales-v3.css';
import '../solve/solve-v3.css';

const URL_ = `${SITE_ORIGIN}/start`;
const TITLE = 'Get a Suwappu API key in one call';
const DESC = 'Register an agent with one unauthenticated POST, get a suwappu_sk_ API key, then make your first quote. No card, no form. curl, TypeScript and Python.';

export const metadata: Metadata = {
  title: TITLE,
  description: DESC,
  keywords: ['get Suwappu API key', 'agent register endpoint', 'crypto swap API key', 'DEX API no signup'],
  alternates: { canonical: URL_ },
  openGraph: { type: 'website', url: URL_, title: TITLE, description: DESC, siteName: 'Suwappu' },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESC },
};

const ld = (o: unknown) => JSON.stringify(o).replace(/</g, '\\u003c');
const ORG = { '@type': 'Organization', name: 'Suwappu', url: SITE_ORIGIN };

export default function StartPage() {
  const s = START;
  const jsonLd = [
    {
      '@context': 'https://schema.org', '@type': 'TechArticle', headline: s.h1, description: s.answer,
      url: URL_, mainEntityOfPage: URL_, dateModified: SOLVE_UPDATED, author: ORG, publisher: ORG,
    },
    {
      '@context': 'https://schema.org', '@type': 'HowTo', name: s.h1, description: s.answer,
      step: [
        { '@type': 'HowToStep', position: 1, name: 'Register an agent', text: `POST ${s.register.url} with a name. The response contains your suwappu_sk_ API key, shown once.` },
        { '@type': 'HowToStep', position: 2, name: s.nextCall.label, text: s.nextCall.note },
      ],
    },
    {
      '@context': 'https://schema.org', '@type': 'FAQPage',
      mainEntity: s.objections.map((o) => ({ '@type': 'Question', name: o.q, acceptedAnswer: { '@type': 'Answer', text: o.a } })),
    },
  ];

  return (
    <div className="summer-page docs-shell institutional-page v3-tone-light sv3-page sv" data-audience="developer">
      {jsonLd.map((o, i) => <script key={i} type="application/ld+json" dangerouslySetInnerHTML={{ __html: ld(o) }} />)}
      <SummerNav />
      <main id="main-content">
        <div className="summer-shell mkt-page">
          <div className="sv3-heroband sv-heroband">
            <Backdrop kind="grid" />
            <header className="sv-hero">
              <div className="sv-hero__main">
                <p className="sv-meta">
                  <span className="sv-chip">For developers and agents</span>
                  <span>Last updated <time dateTime={SOLVE_UPDATED}>{SOLVE_UPDATED}</time></span>
                  <span>By the Suwappu team</span>
                </p>
                <h1 className="sv-h1">{s.h1}</h1>
                <div className="sv-answer">
                  <span className="sv-answer__label">Short answer</span>
                  <p>{s.answer}</p>
                </div>
                <div className="sv-actions">
                  <TrackedLink href={s.cta.href} surface="start" slug="start" kind="primary" className="summer-button summer-button--primary">{s.cta.label}</TrackedLink>
                  <TrackedLink href={s.secondaryCta.href} surface="start" slug="start" kind="secondary" className="summer-button summer-button--secondary">{s.secondaryCta.label}</TrackedLink>
                </div>
              </div>
            </header>
          </div>

          <div className="sv-body">
            <section className="sv-sec" id="register" aria-labelledby="register-h">
              <h2 id="register-h">1. Register an agent</h2>
              <p className="sv-lede">
                <code>{s.register.method} {s.register.url}</code>, auth: {s.register.auth}. Body:
                {' '}<code>name</code> ({s.register.body.name}), optional <code>description</code>, optional <code>callback_url</code>.
              </p>
              <StartKey bash={s.register.bash} ts={s.register.ts} python={s.register.python} />
              <ul className="sv-limits__list sv-note" style={{ paddingLeft: '1.1rem' }}>
                {s.register.keyNotes.map((n) => <li key={n}>{n}</li>)}
              </ul>
            </section>

            <section className="sv-sec" aria-labelledby="quote-h">
              <h2 id="quote-h">2. Make your first quote</h2>
              <p className="sv-lede">{s.nextCall.note}</p>
              <CopyCode code={s.nextCall.code} lang={s.nextCall.lang} label={s.nextCall.label} slug="start" />
            </section>

            <section className="sv-sec" aria-labelledby="cost-h">
              <h2 id="cost-h">What it costs</h2>
              <p className="sv-lede">{s.cost.summary}</p>
            </section>

            <section className="sv-sec" aria-labelledby="obj-h">
              <h2 id="obj-h">Before you ask</h2>
              <dl className="sv-faqlist">
                {s.objections.map((o) => (<div key={o.q}><dt>{o.q}</dt><dd>{o.a}</dd></div>))}
              </dl>
            </section>

            <section className="sv-sec sv-limits" aria-labelledby="limits">
              <p className="sv-limits__kicker">Stated plainly</p>
              <h2 id="limits">What this does not do</h2>
              <ul>{s.limits.map((l) => <li key={l}>{l}</li>)}</ul>
            </section>

            <section className="sv-sec" aria-labelledby="proof">
              <h2 id="proof">Check it yourself</h2>
              <ul className="sv-proof">
                {s.proof.map((l) => (
                  <li key={l.href}>
                    <TrackedLink href={l.href} surface="start" slug="start" kind="proof">{l.label} <span aria-hidden="true">{/^https?:/.test(l.href) ? '↗' : '→'}</span></TrackedLink>
                  </li>
                ))}
              </ul>
            </section>
          </div>

          <ProblemStrip surface="start" slugs={['let-ai-agent-swap-tokens', 'mcp-server-for-crypto-swaps', 'simulate-swap-before-signing', 'free-swap-quote-api']} />
        </div>
      </main>
      <SummerFooter />
    </div>
  );
}
