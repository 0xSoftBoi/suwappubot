'use client';

import { useEffect, useState } from 'react';

type TocItem = { level: number; text: string; id: string };

/**
 * "On this page" rail with IntersectionObserver scroll-spy.
 * Items are derived server-side from the page's headings (stable slug ids).
 */
export default function DocsToc({ items }: { items: TocItem[] }) {
  const [active, setActive] = useState<string>('');

  useEffect(() => {
    if (!items.length) return;
    const headings = items
      .map((i) => document.getElementById(i.id))
      .filter((el): el is HTMLElement => Boolean(el));
    if (!headings.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: '-80px 0px -70% 0px', threshold: 0 },
    );
    headings.forEach((h) => observer.observe(h));
    return () => observer.disconnect();
  }, [items]);

  if (items.length < 2) return null;

  return (
    <aside className="doc-toc" aria-label="On this page">
      <p className="doc-toc__label">On this page</p>
      <ul>
        {items.map((item) => (
          <li
            key={item.id}
            className={`doc-toc__item doc-toc__item--h${item.level}${active === item.id ? ' is-active' : ''}`}
          >
            <a href={`#${item.id}`}>{item.text}</a>
          </li>
        ))}
      </ul>
    </aside>
  );
}
