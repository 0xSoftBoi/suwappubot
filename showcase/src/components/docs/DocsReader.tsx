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
      setSafeHtml(DOMPurify.sanitize(html, { ADD_TAGS: ['code'], ADD_ATTR: ['class'] }));
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
