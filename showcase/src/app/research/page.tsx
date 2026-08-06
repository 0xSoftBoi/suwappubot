import type { Metadata } from 'next';
import Image from 'next/image';
import Navigation from '@/components/Navigation';
import SummerFooter from '@/components/SummerFooter';
import { publishedPosts, plannedPosts } from '@/content/research';
import styles from './research.module.css';

const SITE = 'https://suwappu.bot';
const AUTHOR_NAME = 'Tsolmondorj Natsagdorj';

export const metadata: Metadata = {
  alternates: { canonical: '/research' },
  title: 'Research — Suwappu',
  description:
    'Institutional research from Suwappu on stablecoin reserves, settlement infrastructure, onchain market structure, and financial execution. Methods and source data are public.',
};

function fmtDate(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[m - 1]} ${d}, ${y}`;
}

export default function ResearchPage() {
  // Papers (measurement/theory with released data) lead; engineering notes
  // (how shipped systems work, verified against source) follow separately, so
  // the two genres are never conflated on the index.
  const papers = publishedPosts.filter((p) => p.kind === 'research');
  const engineering = publishedPosts.filter((p) => p.kind === 'engineering');
  const featured = papers.find((p) => p.report) ?? papers[0];

  const collectionLd = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: 'Suwappu Research',
    description: metadata.description,
    url: `${SITE}/research`,
    isAccessibleForFree: true,
    publisher: { '@type': 'Organization', name: 'Suwappu', url: SITE },
    hasPart: papers.map((paper) => ({
      '@type': 'ScholarlyArticle',
      headline: paper.title,
      url: `${SITE}/research/${paper.slug}`,
      datePublished: paper.date,
      author: { '@type': 'Person', name: AUTHOR_NAME },
      ...(paper.report && {
        associatedMedia: {
          '@type': 'MediaObject',
          contentUrl: `${SITE}${paper.report.path}`,
          encodingFormat: 'application/pdf',
        },
      }),
    })),
  };

  return (
    <main id="main-content" className="summer-page docs-shell">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(collectionLd) }}
      />
      <Navigation />
      <div className={`summer-shell mkt-page ${styles.page}`}>
        <header className={styles.hero}>
          <div className={styles.heroTopline}>
            <p className="summer-kicker">Suwappu Research</p>
            <p className={styles.series}>Payments · treasury · market structure</p>
          </div>

          <div className={styles.heroGrid}>
            <h1>Research for financial infrastructure.</h1>
            <div className={styles.heroIntro}>
              <p>
                Independent measurement and control-oriented analysis of stablecoin reserves,
                settlement rails, and onchain market structure. Written for teams that need an
                audit trail, not a narrative.
              </p>
              <p className={styles.byline}>{AUTHOR_NAME} · Suwappu Research</p>
            </div>
          </div>

          <dl className={styles.stats} aria-label="Research coverage">
            <div>
              <dt>{papers.length}</dt>
              <dd>published studies</dd>
            </div>
            <div>
              <dt>183</dt>
              <dd>aligned reserve observations</dd>
            </div>
            <div>
              <dt>20</dt>
              <dd>direct liability legs at head</dd>
            </div>
            <div>
              <dt>Open</dt>
              <dd>methods, code &amp; data</dd>
            </div>
          </dl>
        </header>

        {featured?.report && (
          <section className={styles.section} aria-labelledby="flagship-report">
            <div className={styles.sectionLabel}>
              <span>Flagship report</span>
              <span>
                Report 01 · {fmtDate(featured.report.date)} · {featured.report.pages} pages
              </span>
            </div>

            <article className={styles.reportFeature}>
              <div className={styles.reportCopy}>
                <div className={styles.reportStatus}>
                  <span>Institutional research</span>
                  <span>Reserve &amp; settlement risk</span>
                  <span>Evidence status: research</span>
                </div>
                <h2 id="flagship-report" className={styles.reportTitle}>
                  {featured.report.title}
                </h2>
                <p className={styles.reportSubtitle}>{featured.report.subtitle}</p>
                <p className={styles.reportDek}>
                  At the 1 August head snapshot, the issuer-documented direct liability perimeter
                  reconciles to 1.0003x against the verified Ethereum reserve account. That is a
                  useful control result, not a reserve attestation: encumbrance, messages in flight,
                  and registry completeness sit outside the balance read. The banking implication is
                  the boundary between what can be automated onchain and what still requires issuer
                  and control evidence.
                </p>

                <dl className={styles.reportMetrics} aria-label="Flagship report findings">
                  {featured.report.metrics.map((metric) => (
                    <div key={metric.label}>
                      <dt>{metric.value}</dt>
                      <dd>{metric.label}</dd>
                    </div>
                  ))}
                </dl>

                <div className={styles.actions}>
                  <a className={styles.reportPrimary} href={featured.report.path}>
                    Read institutional report (PDF) →
                  </a>
                  <a className={styles.reportSecondary} href="/research/replication">
                    Methodology &amp; data →
                  </a>
                  <a className={styles.reportTertiary} href={`/research/${featured.slug}`}>
                    Research note →
                  </a>
                </div>
              </div>

              <a
                className={styles.reportCover}
                href={featured.report.path}
                aria-label={`Read ${featured.report.title} as a PDF`}
              >
                <div className={styles.coverTopline}>
                  <span>Suwappu Research</span>
                  <span>Report 01 / Aug 2026</span>
                </div>
                <div className={styles.coverBody}>
                  <p>Payments / Treasury / Digital Assets</p>
                  <h3>{featured.report.title}</h3>
                  <span>{featured.report.subtitle}</span>
                </div>
                <Image
                  className={styles.coverArt}
                  src="/research/reports/omnichain-dollar-bank-cover-art.jpg"
                  width={1536}
                  height={1024}
                  alt=""
                />
                <div className={styles.coverFinding}>
                  <span>Public-state conclusion</span>
                  <strong>Observed coverage reconciles to 1.0003x.</strong>
                  <p>The ~3bp difference is not treated as a reserve cushion.</p>
                </div>
                <div className={styles.coverFooter}>
                  <span>Tsolmondorj Natsagdorj</span>
                  <span>09 pages</span>
                </div>
              </a>
            </article>
          </section>
        )}

        {papers.length > 0 && (
          <section className={styles.section} aria-labelledby="working-papers">
            <div className={styles.sectionLabel}>
              <span id="working-papers">Working papers &amp; methodology</span>
              <span>Methods · data · correction history</span>
            </div>
            <div className={styles.list}>
              {papers.map((p, index) => (
                <article key={p.slug} className={styles.row}>
                  <div className={styles.ordinal} aria-hidden="true">
                    {String(index + 1).padStart(2, '0')}
                  </div>
                  <div className={styles.rowBody}>
                    <div className={styles.metaInline}>
                      <span className="research-tag">{p.category}</span>
                      <time className={styles.date}>{fmtDate(p.date)}</time>
                    </div>
                    <h3 className={styles.title}>
                      <a href={`/research/${p.slug}`}>{p.title}</a>
                    </h3>
                    <p className={styles.dek}>{p.excerpt}</p>
                    <div className={styles.rowLinks}>
                      <a href={`/research/${p.slug}`}>Read study →</a>
                      {p.paperPath && <a href={p.paperPath}>Working paper →</a>}
                      {p.report && <a href={p.report.path}>Report PDF →</a>}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}

        <section className={styles.standard} aria-labelledby="research-standard">
          <div className={styles.standardIntro}>
            <p className="summer-kicker">Evidence standard</p>
            <h2 id="research-standard">Make the perimeter explicit.</h2>
            <p>
              For financial infrastructure, the scope of a measurement is part of the result. Each
              study states the accounting or model perimeter, exposes assumptions and limits, and
              gives the reader a path back to source data.
            </p>
            <a href="/research/replication">Open the replication bundle →</a>
          </div>

          <ol className={styles.standardList}>
            <li>
              <span>01</span>
              <div className={styles.meta}>
                <h3>Define the perimeter</h3>
                <p>Version entities, accounts, inclusion rules, and observation time before interpreting a ratio or model output.</p>
              </div>
            </li>
            <li>
              <span>02</span>
              <div className={styles.meta}>
                <h3>Release the method</h3>
                <p>Working papers, collection code, statistical tests, fixed seeds, and cited datasets ship with the argument.</p>
              </div>
            </li>
            <li>
              <span>03</span>
              <div className={styles.meta}>
                <h3>Version corrections</h3>
                <p>Corrections stay visible, and changed scope or reference data remain part of the audit trail.</p>
              </div>
            </li>
          </ol>
        </section>

        {engineering.length > 0 && (
          <section className={styles.section} aria-labelledby="engineering-notes">
            <div className={styles.sectionLabel}>
              <span id="engineering-notes">Engineering notes</span>
              <span>Source-verified · not research papers</span>
            </div>
            <div className={styles.engineeringList}>
              {engineering.map((p) => (
                <article key={p.slug} className={styles.engineeringRow}>
                  <div className={styles.metaInline}>
                    <span className="research-tag research-tag--muted">{p.category}</span>
                    <time className={styles.date}>{fmtDate(p.date)}</time>
                  </div>
                  <div className={styles.rowBody}>
                    <h3 className={styles.title}>
                      <a href={`/research/${p.slug}`}>{p.title}</a>
                    </h3>
                    <p className={styles.dek}>{p.excerpt}</p>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}

        {plannedPosts.length > 0 && (
          <section className={styles.pipeline} aria-label="Upcoming research and engineering notes">
            <div className={styles.sectionLabel}>
              <span>In the pipeline</span>
              <span>Planned · not published</span>
            </div>
            <ul className={styles.pipelineList}>
              {plannedPosts.map((p) => (
                <li key={p.slug}>
                  <span className="research-tag research-tag--muted">{p.category}</span>
                  <span>{p.title}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

      </div>
      <SummerFooter />
    </main>
  );
}
