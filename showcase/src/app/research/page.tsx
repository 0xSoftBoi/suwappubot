import type { Metadata } from 'next';
import Navigation from '@/components/Navigation';
import SummerFooter from '@/components/SummerFooter';
import { publishedPosts, plannedPosts } from '@/content/research';

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
    <main className="summer-page docs-shell">
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

        {featured && (
          <a className="research-featured" href={`/research/${featured.slug}`}>
            <div className="research-featured__meta">
              <span className="research-tag">{featured.category}</span>
              <time>{fmtDate(featured.date)}</time>
              {featured.readMins && <span>{featured.readMins} min read</span>}
            </div>
            <h2>{featured.title}</h2>
            <p>{featured.excerpt}</p>
            <span className="research-featured__more">Read →</span>
          </a>
        )}

        <ul className="research-feed">
          {rest.map((p) => (
            <li key={p.slug}>
              <a href={`/research/${p.slug}`} className="research-row">
                <div className="research-row__meta">
                  <span className="research-tag">{p.category}</span>
                  <time>{fmtDate(p.date)}</time>
                </div>
                <div className="research-row__body">
                  <h3>{p.title}</h3>
                  <p>{p.excerpt}</p>
                </div>
              </a>
            </li>
          ))}
        </ul>

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
