import type { Metadata } from 'next';
import Image from 'next/image';
import Navigation from '@/components/Navigation';
import SummerFooter from '@/components/SummerFooter';
import { publishedPosts, plannedPosts } from '@/content/research';
import styles from './research.module.css';

const SITE = 'https://suwappu.bot';
const AUTHOR_NAME = 'Tsolmondorj Natsagdorj';

const decisionLenses = [
  {
    seat: 'Reserve / settlement',
    question: 'What does an onchain backing ratio prove—and what issuer, legal, liquidity, and finality risk remains outside it?',
    href: '/research/omnichain-dollar-collateral',
    label: 'USDT0 backing',
  },
  {
    seat: 'Treasury / payments',
    question: 'Can the account that pays a network fee be governed separately from the account that authorizes the payment?',
    href: '/research/tempo-fee-payer-0x76',
    label: 'Tempo fee payer',
  },
  {
    seat: 'Execution',
    question: 'What does the router actually optimize, and how should the decision change when cost, time, or venue evidence is weak?',
    href: '/research/best-price-routing',
    label: 'Routing policy',
  },
  {
    seat: 'Product / incentives',
    question: 'Where does a reward budget land, and which rule changes reward real activity versus additional identities?',
    href: '/research/points-programs-tullock-contests',
    label: 'Incentive economics',
  },
  {
    seat: 'Model risk',
    question: 'What happens when a solver is verified but its most important prediction fails outcome analysis?',
    href: '/research/airdrop-concentration',
    label: 'Model validation',
  },
] as const;

export const metadata: Metadata = {
  alternates: { canonical: '/research' },
  title: 'Research — Suwappu',
  description:
    'Institutional research from Suwappu on stablecoin backing, treasury controls, execution governance, incentive economics, and model validation. Methods, limitations, corrections, and source data are public.',
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
      dateModified: paper.updated ?? paper.date,
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
    <main id="main-content" className="summer-page docs-shell institutional-page">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(collectionLd) }}
      />
      <Navigation />
      <div className={`summer-shell mkt-page ${styles.page}`}>
        <header className={styles.hero}>
          <div className={styles.heroTopline}>
            <p className="summer-kicker">Suwappu Research</p>
            <p className={styles.series}>Treasury · payments · execution · model risk</p>
          </div>

          <div className={styles.heroGrid}>
            <h1>Research for financial infrastructure.</h1>
            <div className={styles.heroIntro}>
              <p>
                Written from the decision seat: what a treasurer, payments operator, execution
                desk, or risk function can actually act on. Each study separates measured state,
                inference, and the control or assurance gap that remains.
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
              <dd>aligned USDT0 observations</dd>
            </div>
            <div>
              <dt>20</dt>
              <dd>direct supply legs at head</dd>
            </div>
            <div>
              <dt>Open</dt>
              <dd>methods, code &amp; data</dd>
            </div>
          </dl>
        </header>

        <section className={styles.decisionMap} aria-labelledby="decision-map">
          <div className={styles.sectionLabel}>
            <span id="decision-map">Read by decision</span>
            <span>Five institutional lenses · one evidence standard</span>
          </div>
          <div className={styles.decisionList}>
            {decisionLenses.map((lens, index) => (
              <a key={lens.href} className={styles.decisionRow} href={lens.href}>
                <span className={styles.decisionOrdinal}>{String(index + 1).padStart(2, '0')}</span>
                <span className={styles.decisionSeat}>{lens.seat}</span>
                <span className={styles.decisionQuestion}>{lens.question}</span>
                <span className={styles.decisionLink}>{lens.label} →</span>
              </a>
            ))}
          </div>
        </section>

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
                  <span>Backing &amp; settlement risk</span>
                  <span>Evidence status: research</span>
                </div>
                <h2 id="flagship-report" className={styles.reportTitle}>
                  {featured.report.title}
                </h2>
                <p className={styles.reportSubtitle}>{featured.report.subtitle}</p>
                <p className={styles.reportDek}>
                  At the 1 August head snapshot, documented direct USDT0 supply reconciles to
                  1.000298x against USDT in the verified Ethereum backing account. That is a
                  token-unit accounting result, not evidence about Tether&rsquo;s reserve portfolio,
                  redemption capacity, legal availability, stressed liquidity, or prudential
                  treatment. The report separates those assurance layers explicitly.
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
                  <span>Protocol-backing conclusion</span>
                  <strong>Observed token-unit coverage is 1.000298x.</strong>
                  <p>Par within measurement tolerance; not an economic reserve cushion.</p>
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
                  <div className={`${styles.rowBody} ${p.indexFigure ? styles.rowBodyWithFigure : ''}`}>
                    <div className={styles.rowCopy}>
                      <div className={styles.metaInline}>
                        <span className="research-tag">{p.category}</span>
                        <time className={styles.date}>{fmtDate(p.date)}</time>
                        {p.updated && <span className={styles.revision}>Revised {fmtDate(p.updated)}</span>}
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
                    {p.indexFigure && (
                      <figure className={styles.rowFigure}>
                        <Image
                          src={p.indexFigure.src}
                          width={720}
                          height={480}
                          alt={p.indexFigure.alt}
                        />
                        <figcaption>{p.indexFigure.caption}</figcaption>
                      </figure>
                    )}
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
              study states its measurement perimeter, separates observed facts from inference and
              external assurance, exposes limitations, and gives the reader a path back to source data.
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
            <li>
              <span>04</span>
              <div className={styles.meta}>
                <h3>Separate assurance layers</h3>
                <p>A chain-state result is not promoted into a legal, credit, liquidity, regulatory, or prudential conclusion without separate evidence.</p>
              </div>
            </li>
            <li>
              <span>05</span>
              <div className={styles.meta}>
                <h3>State the decision use</h3>
                <p>A verified calculation can still be unfit for a particular decision. Each study states what the evidence can support, what it cannot, and what would change that status.</p>
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
                    {p.updated && <span className={styles.revision}>Revised {fmtDate(p.updated)}</span>}
                  </div>
                  <div className={`${styles.rowBody} ${p.indexFigure ? styles.rowBodyWithFigure : ''}`}>
                    <div className={styles.rowCopy}>
                      <h3 className={styles.title}>
                        <a href={`/research/${p.slug}`}>{p.title}</a>
                      </h3>
                      <p className={styles.dek}>{p.excerpt}</p>
                      <div className={`research-links ${styles.rowLinks}`}>
                        <a href={`/research/${p.slug}`}>Read control note <span aria-hidden="true">→</span></a>
                      </div>
                    </div>
                    {p.indexFigure && (
                      <figure className={styles.rowFigure}>
                        <Image src={p.indexFigure.src} alt={p.indexFigure.alt} width={960} height={600} />
                        <figcaption>{p.indexFigure.caption}</figcaption>
                      </figure>
                    )}
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
