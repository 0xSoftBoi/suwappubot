import type { Metadata } from 'next';
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
    'Open, reproducible research from Suwappu on stablecoin collateral, incentive design, onchain market structure, and financial execution infrastructure.',
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
  const [featured, ...rest] = papers;

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
            <p className={styles.series}>Markets · protocols · execution</p>
          </div>

          <div className={styles.heroGrid}>
            <h1>Measured, released, corrected in public.</h1>
            <div className={styles.heroIntro}>
              <p>
                Original measurement and mechanism research for financial systems that move value
                onchain. We publish the method, the data, the code, the limits — and the evidence
                that proved us wrong.
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
              <dt>376k</dt>
              <dd>recipient rows measured</dd>
            </div>
            <div>
              <dt>Open</dt>
              <dd>papers, code &amp; data</dd>
            </div>
          </dl>
        </header>

        {featured && (
          <section className={styles.section} aria-labelledby="latest-research">
            <div className={styles.sectionLabel}>
              <span>Latest study</span>
              <span>Research 01</span>
            </div>

            <article className={styles.feature}>
              <div className={styles.featureCopy}>
                <div className={styles.metaInline}>
                  <span className="research-tag">{featured.category}</span>
                  <time className={styles.date}>{fmtDate(featured.date)}</time>
                  {featured.readMins && (
                    <span className={styles.readMins}>{featured.readMins} min read</span>
                  )}
                </div>
                <h2 id="latest-research" className={styles.featureTitle}>
                  <a href={`/research/${featured.slug}`}>{featured.title}</a>
                </h2>
                <p className={styles.featureDek}>{featured.excerpt}</p>
                <div className={styles.actions}>
                  <a className={styles.primaryLink} href={`/research/${featured.slug}`}>
                    Read the study →
                  </a>
                  {featured.paperPath && (
                    <a className={styles.secondaryLink} href={featured.paperPath}>
                      Full working paper →
                    </a>
                  )}
                </div>
              </div>

              {featured.indexFigure && (
                <figure className={styles.featureFigure}>
                  <img src={featured.indexFigure.src} alt={featured.indexFigure.alt} />
                  <figcaption>{featured.indexFigure.caption}</figcaption>
                </figure>
              )}
            </article>
          </section>
        )}

        {rest.length > 0 && (
          <section className={styles.section} aria-labelledby="published-research">
            <div className={styles.sectionLabel}>
              <span id="published-research">Published research</span>
              <span>Methods &amp; results</span>
            </div>
            <div className={styles.list}>
              {rest.map((p, index) => (
                <article key={p.slug} className={styles.row}>
                  <div className={styles.ordinal} aria-hidden="true">
                    {String(index + 2).padStart(2, '0')}
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
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}

        <section className={styles.standard} aria-labelledby="research-standard">
          <div className={styles.standardIntro}>
            <p className="summer-kicker">Research standard</p>
            <h2 id="research-standard">Make the claim inspectable.</h2>
            <p>
              The public artifact is part of the result. Each study states what was measured,
              exposes its assumptions and limits, and gives a reader a path back to the evidence.
            </p>
            <a href="/research/replication">Open the replication bundle →</a>
          </div>

          <ol className={styles.standardList}>
            <li>
              <span>01</span>
              <div className={styles.meta}>
                <h3>Measure first</h3>
                <p>Prefer public chain state, complete recipient vectors, and explicitly stated models over screenshots or anecdotes.</p>
              </div>
            </li>
            <li>
              <span>02</span>
              <div className={styles.meta}>
                <h3>Release the work</h3>
                <p>Working papers, collection code, statistical tests, fixed seeds, and cited datasets ship with the argument.</p>
              </div>
            </li>
            <li>
              <span>03</span>
              <div className={styles.meta}>
                <h3>Correct visibly</h3>
                <p>When a result changes, the correction leads. Superseded evidence stays available where it is needed to audit what changed.</p>
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

        <section className={styles.buildCta} aria-labelledby="build-from-research">
          <div>
            <p className="summer-kicker">From research to execution</p>
            <h2 id="build-from-research">Building on Suwappu?</h2>
            <p>Start with the API, SDK, MCP, and agent-facing developer surface.</p>
          </div>
          <div className={styles.buildLinks}>
            <a href="/docs">Developer docs →</a>
            <a href="/agents">Agent surface →</a>
          </div>
        </section>
      </div>
      <SummerFooter />
    </main>
  );
}
