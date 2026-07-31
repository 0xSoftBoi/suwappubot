import type { Metadata } from 'next';
import Navigation from '@/components/Navigation';
import SummerFooter from '@/components/SummerFooter';
import { publishedPosts, plannedPosts } from '@/content/research';
import styles from './research.module.css';

export const metadata: Metadata = {
  title: 'Research — Suwappu',
  description:
    'Engineering and protocol writing from the Suwappu team — best-price routing, gasless transactions, key management, and agent infrastructure.',
};

function fmtDate(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[m - 1]} ${d}, ${y}`;
}

export default function ResearchPage() {
  const [featured, ...rest] = publishedPosts;
  return (
    <main id="main-content" className="summer-page docs-shell sw-dark">
      <Navigation />
      <div className="summer-shell mkt-page">
        <header className="mkt-hero">
          <p className="summer-kicker">Research &amp; writing</p>
          <h1>How we build it.</h1>
          <p className="mkt-hero__lead">
            Deep dives on cross-chain routing, gasless transactions, key management, and
            agent infrastructure — written to stand on their own.
          </p>
        </header>

        <div className={`sw-rows ${styles.list}`}>
          {featured && (
            <article className={`sw-row ${styles.row} ${styles['row--featured']}`}>
              <div className={styles.meta}>
                <span className="research-tag">{featured.category}</span>
                <time className={styles.date}>{fmtDate(featured.date)}</time>
                {featured.readMins && <span className={styles.readMins}>{featured.readMins} min read</span>}
              </div>
              <div>
                <h2 className={styles.title}>
                  <a href={`/research/${featured.slug}`}>{featured.title}</a>
                </h2>
                <p className={styles.dek}>{featured.excerpt}</p>
                <span className={styles.more} aria-hidden="true">Read →</span>
              </div>
            </article>
          )}

          {rest.map((p) => (
            <article key={p.slug} className={`sw-row ${styles.row}`}>
              <div className={styles.meta}>
                <span className="research-tag">{p.category}</span>
                <time className={styles.date}>{fmtDate(p.date)}</time>
              </div>
              <div>
                <h3 className={styles.title}>
                  <a href={`/research/${p.slug}`}>{p.title}</a>
                </h3>
                <p className={styles.dek}>{p.excerpt}</p>
              </div>
            </article>
          ))}
        </div>

        {plannedPosts.length > 0 && (
          <section className="research-upcoming" aria-label="Upcoming">
            <p className="summer-kicker">In the pipeline</p>
            <ul>
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
