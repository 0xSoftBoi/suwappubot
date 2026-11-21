'use client';

import { useEffect, useMemo, useState } from 'react';
import { track } from '@/lib/analytics';

type Tile = { slug: string; audience: string; h1: string; teaser: string; hay: string };
type Group = { audience: string; heading: string; description: string };

/**
 * Hub tiles grouped by audience with a client-side search + audience filter.
 * With JavaScript off, every tile is in the server HTML (the filter is inert).
 */
export default function HubFilter({ groups, tiles }: { groups: Group[]; tiles: Tile[] }) {
  const [q, setQ] = useState('');
  const [aud, setAud] = useState<string>('all');
  const needle = q.trim().toLowerCase();

  // The header links to /solve#trader, #developer and #desk. A section is not
  // rendered while a different audience (or a search) is filtering it out, so
  // a fragment alone would land nowhere: select that audience, clear the
  // search, then scroll once the section exists.
  useEffect(() => {
    const known = new Set(groups.map((g) => g.audience));
    const apply = () => {
      const target = window.location.hash.slice(1);
      if (!known.has(target)) return;
      setQ('');
      setAud(target);
      requestAnimationFrame(() => document.getElementById(target)?.scrollIntoView({ block: 'start' }));
    };
    apply();
    window.addEventListener('hashchange', apply);
    return () => window.removeEventListener('hashchange', apply);
  }, [groups]);
  const shown = useMemo(
    () => tiles.filter((t) => (aud === 'all' || t.audience === aud) && (!needle || t.hay.includes(needle))),
    [tiles, aud, needle],
  );

  return (
    <>
      <div className="sv-filter" role="search">
        <label className="sv-filter__search">
          <span className="sv-sr">Search problems</span>
          <input
            type="search" value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Search: stuck swap, MCP, slippage…" autoComplete="off"
          />
        </label>
        <div className="sv-filter__chips" role="group" aria-label="Filter by audience">
          {[{ audience: 'all', heading: 'All' }, ...groups].map((g) => (
            <button
              key={g.audience} type="button" aria-pressed={aud === g.audience}
              onClick={() => setAud(g.audience)}
            >
              {g.audience === 'all' ? 'All' : g.audience === 'trader' ? 'Traders' : g.audience === 'developer' ? 'Developers' : 'Desks'}
            </button>
          ))}
        </div>
      </div>
      <p className="sv-sr" role="status" aria-live="polite">{shown.length} problems shown</p>

      {groups.map((g) => {
        const items = shown.filter((t) => t.audience === g.audience);
        if (!items.length) return null;
        return (
          <section key={g.audience} id={g.audience} className="sv-group" data-audience={g.audience} aria-labelledby={`g-${g.audience}`}>
            <header className="sv-group__head">
              <h2 id={`g-${g.audience}`}>{g.heading}</h2>
              <p>{g.description}</p>
            </header>
            <ul className="sv-tiles">
              {items.map((t) => (
                <li key={t.slug}>
                  <a
                    className="v3-tile sv-tile" href={`/solve/${t.slug}`}
                    onClick={() => track('cta_clicked', { surface: 'solve_hub', slug: t.slug, dest: `/solve/${t.slug}`, kind: 'related' })}
                  >
                    <span className="v3-tile__body">
                      <span className="v3-tile__index">{g.audience}</span>
                      <span className="v3-tile__title">{t.h1}</span>
                      <span className="v3-tile__text">{t.teaser}</span>
                      <span className="v3-tile__arrow" aria-hidden="true">→</span>
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      {shown.length === 0 && (
        <p className="sv-empty">No page matches that yet. Try a chain, a protocol or a symptom, or <a href="/start">get an API key</a>.</p>
      )}
    </>
  );
}
