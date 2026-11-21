import type { Metadata } from 'next';
import SummerNav from '@/components/SummerNav';
import SummerFooter from '@/components/SummerFooter';
import { Reveal, Backdrop } from '@/components/v3';
import '../content-v3.css';

export const metadata: Metadata = {
  title: 'Changelog',
  description: 'What shipped, and when. New chains, features, and improvements to the Suwappu bot, terminal, and agent API.',
};

import { entries } from '@/data/changelog';

function fmtDate(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[m - 1]} ${d}, ${y}`;
}

// Minimal inline markdown for `code` spans in the points.
function withCode(s: string) {
  const parts = s.split(/(`[^`]+`)/g);
  return parts.map((p, i) =>
    p.startsWith('`') && p.endsWith('`') ? <code key={i}>{p.slice(1, -1)}</code> : <span key={i}>{p}</span>,
  );
}

const AXIS_START = Date.UTC(2026, 2, 1);
const AXIS_END = Date.UTC(2026, 7, 1);
const AXIS_MONTHS = ['Mar', 'Apr', 'May', 'Jun', 'Jul'];
const axisPct = (t: number) => ((t - AXIS_START) / (AXIS_END - AXIS_START)) * 100;
const isoTime = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};

// Real release dates from `entries`, equal-size nodes; only the newest is accented.
function ReleaseTimeline() {
  const seen: Record<string, number> = {};
  return (
    <div className="cv3-rt" role="img" aria-label={`${entries.length} releases, ${fmtDate(entries[entries.length - 1].date)} to ${fmtDate(entries[0].date)}`}>
      <div className="cv3-rt__plot">
        <span className="cv3-rt__axis" />
        {AXIS_MONTHS.map((m, i) => {
          const left = axisPct(Date.UTC(2026, 2 + i, 1));
          return <span className="cv3-rt__tick" key={m} style={{ left: `${left}%` }}><b>{m}</b></span>;
        })}
        {entries.map((e, i) => {
          const row = (seen[e.date] = (seen[e.date] ?? -1) + 1);
          return (
            <span key={`${e.date}-${e.title}`} className={`cv3-rt__node${i === 0 ? ' is-latest' : ''}`}
              style={{ left: `${axisPct(isoTime(e.date))}%`, translate: `-50% ${-row * 22}px`, '--d': `${(entries.length - i) * 0.12}s` } as React.CSSProperties} />
          );
        })}
      </div>
      <div className="cv3-rt__cap"><span>{fmtDate(entries[entries.length - 1].date)}</span><span>{fmtDate(entries[0].date)}</span></div>
    </div>
  );
}

export default function ChangelogPage() {
  return (
    <div className="summer-page docs-shell institutional-page v3-tone-light cv3-page">
      <SummerNav />
      <main id="main-content">
        <div className="cv3-hero">
          <Backdrop kind="mesh" />
          <Backdrop kind="grid" />
          <div className="v3-wrap cv3-hero__grid">
            <header>
              <p className="v3-kicker">Changelog</p>
              <h1>What shipped, <em>and when.</em></h1>
              <p className="cv3-lead">
                New chains, features, and improvements across the bot, terminal, and agent API.
                We ship continuously: here&apos;s the trail.
              </p>
            </header>
            <Reveal className="cv3-art cv3-art--wide" delay={120}><ReleaseTimeline /></Reveal>
          </div>
        </div>

        <div className="v3-wrap cv3-pad-bottom">
          <ol className="cv3-tl">
            {entries.map((e, ei) => (
              <Reveal as="li" className={`cv3-tl__item${ei === 0 ? ' is-latest' : ''}`} key={`${e.date}-${e.title}`}>
                <div className="cv3-tl__when">
                  <time dateTime={e.date}>{fmtDate(e.date)}</time>
                  <span className={`cv3-tag cv3-tag--${e.tag.toLowerCase()}`}>{e.tag}</span>
                </div>
                <span className="cv3-tl__node" aria-hidden="true" />
                <article className="cv3-tl__body">
                  <h2>{e.title}</h2>
                  <ul>
                    {e.points.map((pt, pi) => (
                      <li key={pi}>{withCode(pt)}</li>
                    ))}
                  </ul>
                </article>
              </Reveal>
            ))}
          </ol>
        </div>
      </main>
      <SummerFooter />
    </div>
  );
}
