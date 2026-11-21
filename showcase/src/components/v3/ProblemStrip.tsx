import { getSolvePage, teaser } from '@/data/solve';
import TrackedLink from '../solve/TrackedLink';
import '@/app/solve/solve-v3.css';

/**
 * "Problems this solves": 2-4 contextual /solve links for a marketing page.
 * Each tile names the problem and gives the one-line answer. Server component;
 * clicks fire `cta_clicked` with surface `problem_strip:<page>`. Styles: solve-v3.css.
 */
export default function ProblemStrip({
  slugs, surface, heading = 'Problems this solves', className = '',
}: { slugs: string[]; surface: string; heading?: string; className?: string }) {
  const pages = slugs.map(getSolvePage).filter((p): p is NonNullable<typeof p> => Boolean(p));
  if (!pages.length) return null;
  return (
    <section className={`sv-strip ${className}`.trim()} aria-label={heading}>
      <div className="sv-strip__head">
        <h2>{heading}</h2>
        <TrackedLink href="/solve" surface={`problem_strip:${surface}`} slug="hub" kind="link" className="sv-strip__all">All problems →</TrackedLink>
      </div>
      <ul className="sv-tiles">
        {pages.map((p) => (
          <li key={p.slug}>
            <TrackedLink href={`/solve/${p.slug}`} surface={`problem_strip:${surface}`} slug={p.slug} kind="related" className="v3-tile sv-tile">
              <span className="v3-tile__body">
                <span className="v3-tile__index">{p.audience}</span>
                <span className="v3-tile__title">{p.h1}</span>
                <span className="v3-tile__text">{teaser(p, 120)}</span>
                <span className="v3-tile__arrow" aria-hidden="true">→</span>
              </span>
            </TrackedLink>
          </li>
        ))}
      </ul>
    </section>
  );
}
