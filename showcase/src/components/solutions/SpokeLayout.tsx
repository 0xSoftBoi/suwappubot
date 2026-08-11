import Navigation from '@/components/Navigation';
import SummerFooter from '@/components/SummerFooter';
import FaqAccordion, { type FaqItem } from '@/components/FaqAccordion';
import { TELEGRAM_URL } from '@/lib/links';
import styles from './spoke.module.css';

/**
 * Shared skeleton for the four /solutions/* job pages. Same anatomy every
 * time (hero, problem, how-it-works, build-vs-buy, limits, one snippet,
 * FAQ, dual CTA) so the four spokes read as one family instead of four
 * one-off pages. See docs/plans/solutions-build-spec.md for the anatomy.
 */

export type SpokeBuildVsBuy = { rows: string[] };
export type SpokeLimit = { title: string; body: string };
export type SpokeSnippet = { file: string; code: string };

export interface SpokeContent {
  kicker: string;
  h1: string;
  lead: string;
  statLine: string;
  problem: { heading: string; body: string };
  flow: string[];
  buildVsBuy: SpokeBuildVsBuy;
  limits: SpokeLimit[];
  snippet: SpokeSnippet;
  faqs: FaqItem[];
  docsCta: { label: string; href: string };
}

export default function SpokeLayout({ content }: { content: SpokeContent }) {
  const { kicker, h1, lead, statLine, problem, flow, buildVsBuy, limits, snippet, faqs, docsCta } =
    content;

  return (
    <main id="main-content" className="summer-page docs-shell institutional-page">
      <Navigation />
      <div className="summer-shell mkt-page">
        <header className="mkt-hero mkt-hero--center">
          <p className="summer-kicker">{kicker}</p>
          <h1>{h1}</h1>
          <p className="mkt-hero__lead">{lead}</p>
          <p className={styles.stat}>{statLine}</p>
        </header>

        <section className={styles.problem}>
          <h2 className="mkt-h2">{problem.heading}</h2>
          <p className={styles.problemBody}>{problem.body}</p>
        </section>

        <section className={styles.howItWorks} aria-label="How it works">
          <p className="sw-kicker">How it works</p>
          <div className="summer-flow">
            {flow.map((step, idx) => (
              <div key={step}>
                <span>0{idx + 1}</span>
                <strong>{step}</strong>
              </div>
            ))}
          </div>
        </section>

        <section className={styles.bvb} aria-labelledby="bvb-title">
          <h2 id="bvb-title" className="mkt-h2">
            Build it yourself, or make one call.
          </h2>
          <div className="compare__scroll" role="region" aria-label="Build versus buy" tabIndex={0}>
            <table className="compare-table">
              <caption className="sr-only">
                What you would otherwise build, compared to what Suwappu handles.
              </caption>
              <thead>
                <tr>
                  <th scope="col" className="compare-table__rowhead">
                    You&apos;d have to build
                  </th>
                  <th scope="col" className="compare-table__colhead compare-table__colhead--us">
                    <span className="compare-table__colname">One API call</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {buildVsBuy.rows.map((row) => (
                  <tr key={row}>
                    <th scope="row" className="compare-table__rowhead">
                      {row}
                    </th>
                    <td className="compare-cell compare-cell--yes">
                      <span className="compare-cell__glyph" aria-hidden="true">
                        ✓
                      </span>
                      <span className="sr-only">Handled by Suwappu</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="agents-caps" aria-label="Limits and safety">
          <p className="summer-kicker">Limits &amp; safety</p>
          <h2 className="mkt-h2">What stays under your control.</h2>
          <div className="agents-caps__grid">
            {limits.map((l) => (
              <article className="agents-cap" key={l.title}>
                <h3>{l.title}</h3>
                <p>{l.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className={styles.codeSection} aria-label="Code example">
          <p className="sw-kicker">In code</p>
          <div className={`${styles.codeShell}`}>
            <div className="summer-code sw-card-dark" aria-label={snippet.file}>
              <div className="summer-code__bar">
                <span />
                <span />
                <span />
                <b>{snippet.file}</b>
              </div>
              <pre>
                <code>{snippet.code}</code>
              </pre>
            </div>
          </div>
        </section>

        <section className="mkt-faq" aria-label="Frequently asked questions">
          <h2 className="mkt-h2">FAQ</h2>
          <FaqAccordion items={faqs} />
        </section>

        <section className="mkt-cta">
          <h2>Start in a minute.</h2>
          <div className="summer-actions summer-cta__actions">
            <a className="summer-button summer-button--primary" href="/docs/quick-start/overview">
              Get an API key
            </a>
            <a className="summer-button summer-button--secondary" href={docsCta.href}>
              {docsCta.label}
            </a>
            <a className="summer-button summer-button--secondary" href="/contact">
              Talk to us
            </a>
          </div>
          <p className={styles.ctaFoot}>
            Not a developer? Try the same execution engine from the{' '}
            <a href={TELEGRAM_URL} target="_blank" rel="noopener noreferrer">
              Telegram bot
            </a>
            .
          </p>
        </section>
      </div>
      <SummerFooter />
    </main>
  );
}
