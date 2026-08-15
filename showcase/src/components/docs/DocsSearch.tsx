'use client';

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import docsData from '../../data/docs.json';

type Hit = {
  sectionId: string;
  sectionTitle: string;
  slug: string;
  title: string;
  description: string;
  url: string;
  haystack: string;
};

// Flat search index built once from docs.json.
const INDEX: Hit[] = docsData.sections
  .filter((s) => s.pages.length > 0)
  .flatMap((s) =>
    s.pages.map((p) => ({
      sectionId: s.id,
      sectionTitle: s.title,
      slug: p.slug,
      title: p.title,
      description: p.description || '',
      url: `/docs/${s.id}/${p.slug}`,
      haystack: `${s.title} ${p.title} ${p.description || ''}`.toLowerCase(),
    })),
  );

export default function DocsSearch() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return INDEX.slice(0, 8);
    const terms = query.split(/\s+/);
    return INDEX.filter((h) => terms.every((t) => h.haystack.includes(t))).slice(0, 12);
  }, [q]);

  const close = useCallback(() => {
    setOpen(false);
    setQ('');
    setActive(0);
  }, []);

  // Global Cmd/Ctrl+K to open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === 'Escape') {
        close();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 20);
  }, [open]);

  useEffect(() => setActive(0), [q]);

  const go = (url: string) => {
    close();
    window.location.href = url;
  };

  const onInputKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && results[active]) {
      e.preventDefault();
      go(results[active].url);
    }
  };

  return (
    <>
      <button type="button" className="docs-search__trigger" onClick={() => setOpen(true)}>
        <span className="docs-search__trigger-icon" aria-hidden="true">⌕</span>
        <span>Search docs…</span>
        <kbd className="docs-search__kbd">⌘K</kbd>
      </button>

      {open && (
        <div className="docs-search__overlay" role="dialog" aria-modal="true" aria-label="Search documentation" onClick={close}>
          <div className="docs-search__modal" onClick={(e) => e.stopPropagation()}>
            <div className="docs-search__inputrow">
              <span className="docs-search__trigger-icon" aria-hidden="true">⌕</span>
              <input
                ref={inputRef}
                className="docs-search__input"
                placeholder="Search the docs…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={onInputKey}
                aria-label="Search documentation"
              />
              <kbd className="docs-search__kbd">esc</kbd>
            </div>

            <div className="docs-search__results">
              {results.length === 0 && <p className="docs-search__empty">No results for “{q}”.</p>}
              {results.map((h, i) => (
                <a
                  key={h.url}
                  href={h.url}
                  className={`docs-search__result${i === active ? ' is-active' : ''}`}
                  onMouseEnter={() => setActive(i)}
                  onClick={(e) => { e.preventDefault(); go(h.url); }}
                >
                  <span className="docs-search__result-section">{h.sectionTitle}</span>
                  <span className="docs-search__result-title">{h.title}</span>
                  {h.description && <span className="docs-search__result-desc">{h.description}</span>}
                </a>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
