'use client';

import { useState, type ReactNode } from 'react';
import { track } from '@/lib/analytics';

type Item = { slug: string; name: string; headline: string; category: string; audience: string; status?: string };
const FILTERS = [
  { id: 'all', label: 'All' }, { id: 'trader', label: 'Traders' },
  { id: 'developer', label: 'Developers' }, { id: 'desk', label: 'Desks' },
];

/**
 * Catalogue grouped by category with an audience filter. With JavaScript off
 * every tile is in the server HTML (the filter is inert). `arts` are the
 * pre-rendered mini visuals, keyed by slug.
 */
export default function ProductsCatalogue({
  categories, items, arts,
}: { categories: string[]; items: Item[]; arts: Record<string, ReactNode> }) {
  const [aud, setAud] = useState('all');
  const pick = (id: string) => { setAud(id); track('hub_filter', { surface: 'products', audience: id }); };
  return (
    <>
      <div className="pdx-filter" role="group" aria-label="Filter products by audience">
        {FILTERS.map((f) => (
          <button key={f.id} type="button" aria-pressed={aud === f.id} onClick={() => pick(f.id)}>{f.label}</button>
        ))}
      </div>
      {categories.map((c) => {
        const list = items.filter((i) => i.category === c && (aud === 'all' || i.audience === aud));
        if (!list.length) return null;
        return (
          <section key={c} id={c.toLowerCase()} className="pdx-group" aria-labelledby={`g-${c}`}>
            <h2 id={`g-${c}`} className="pdx-h2">{c}</h2>
            <ul className="pdx-tiles">
              {list.map((p) => (
                <li key={p.slug}>
                  <a href={`/products/${p.slug}`} className="v3-tile sv-tile pdx-tile" onClick={() => track('cta_clicked', { surface: 'products', slug: p.slug, dest: `/products/${p.slug}`, kind: 'related' })}>
                    <span className="v3-tile__body">
                      <span className="pdx-tile__art v3-tone-dark" aria-hidden="true">{arts[p.slug]}</span>
                      <span className="v3-tile__index">{p.audience}</span>
                      <span className="v3-tile__title">
                        {p.name}
                        {p.status === 'paper' && <span className="pdx-chip">Paper mode</span>}
                        {p.status === 'preview' && <span className="pdx-chip pdx-chip--preview">Preview</span>}
                      </span>
                      <span className="v3-tile__text">{p.headline}</span>
                      <span className="v3-tile__arrow" aria-hidden="true">→</span>
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </>
  );
}
