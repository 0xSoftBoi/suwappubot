'use client';

import { useRef, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';

type Props = {
  html: string;
  title: string;
};

export default function DocsReader({ html, title }: Props) {
  const readerRef = useRef<HTMLDivElement>(null);
  const [safeHtml, setSafeHtml] = useState(html);

  useEffect(() => {
    import('dompurify').then((mod) => {
      const DOMPurify = mod.default || mod;
      setSafeHtml(DOMPurify.sanitize(html, { ADD_TAGS: ['code', 'span'], ADD_ATTR: ['class', 'id'] }));
    });
  }, [html]);

  // Add copy buttons to all <pre> code blocks after mount
  useEffect(() => {
    const el = readerRef.current;
    if (!el) return;

    el.querySelectorAll('pre').forEach((pre) => {
      if (pre.querySelector('.copy-btn')) return; // already added

      const btn = document.createElement('button');
      btn.className = 'copy-btn';
      btn.textContent = 'Copy';
      btn.addEventListener('click', () => {
        const code = pre.querySelector('code')?.textContent ?? pre.textContent ?? '';
        navigator.clipboard.writeText(code).then(() => {
          btn.textContent = 'Copied!';
          btn.classList.add('copy-btn--copied');
          setTimeout(() => {
            btn.textContent = 'Copy';
            btn.classList.remove('copy-btn--copied');
          }, 2000);
        });
      });
      pre.appendChild(btn);
    });
  }, [safeHtml]);

  // Wire language-tab switching (cURL / TypeScript / Python widgets)
  useEffect(() => {
    const el = readerRef.current;
    if (!el) return;

    const groups = el.querySelectorAll<HTMLElement>('.code-tabs');
    const cleanups: Array<() => void> = [];

    groups.forEach((group) => {
      const tabs = Array.from(group.querySelectorAll<HTMLButtonElement>('.code-tabs__tab'));
      const panels = Array.from(group.querySelectorAll<HTMLElement>('.code-tabs__panel'));
      const onClick = (e: Event) => {
        const idx = (e.currentTarget as HTMLElement).dataset.tab;
        tabs.forEach((t) => t.classList.toggle('is-active', t.dataset.tab === idx));
        panels.forEach((p) => p.classList.toggle('is-active', p.dataset.tab === idx));
      };
      tabs.forEach((t) => t.addEventListener('click', onClick));
      cleanups.push(() => tabs.forEach((t) => t.removeEventListener('click', onClick)));
    });

    return () => cleanups.forEach((fn) => fn());
  }, [safeHtml]);

  return (
    <motion.div
      ref={readerRef}
      className="doc-reader"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.25, 0.4, 0.25, 1] }}
      dangerouslySetInnerHTML={{ __html: safeHtml }}
    />
  );
}
