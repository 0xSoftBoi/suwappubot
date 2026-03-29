'use client';

import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { usePretextAccordion } from '../../lib/pretext/usePretextAccordion';
import { FONTS } from '../../lib/pretext/pretextFonts';

type DocPage = {
  slug: string;
  title: string;
  description: string;
};

type Section = {
  id: string;
  title: string;
  pages: DocPage[];
};

export default function DocsAccordion({ sections }: { sections: Section[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [contentWidth, setContentWidth] = useState(0);

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      setContentWidth(entries[0]?.contentRect.width ?? 0);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Build text items for pretext measurement
  const accordionItems = sections.map((s) => ({
    id: s.id,
    content: s.pages.map((p) => `${p.title}\n${p.description}`).join('\n\n'),
    font: FONTS.body.regular,
  }));

  const { measurements, ready } = usePretextAccordion(accordionItems, contentWidth - 48, 24);

  return (
    <div ref={contentRef} className="docs-accordion">
      {sections.map((section) => {
        const isOpen = openId === section.id;
        const measuredHeight = measurements.get(section.id) ?? 0;
        // Add padding for page links (each ~52px) + gap
        const expandedHeight = section.pages.length * 72 + 24;

        return (
          <div key={section.id} id={section.id} className="docs-accordion__item">
            <button
              className={`docs-accordion__header ${isOpen ? 'docs-accordion__header--open' : ''}`}
              onClick={() => setOpenId(isOpen ? null : section.id)}
            >
              <div>
                <h3 className="docs-accordion__title">{section.title}</h3>
                <span className="docs-accordion__meta">
                  {section.pages.length} {section.pages.length === 1 ? 'page' : 'pages'}
                </span>
              </div>
              <motion.span
                className="docs-accordion__chevron"
                animate={{ rotate: isOpen ? 180 : 0 }}
                transition={{ duration: 0.2 }}
              >
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                  <path d="M5 8l5 5 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </motion.span>
            </button>

            <AnimatePresence initial={false}>
              {isOpen && (
                <motion.div
                  className="docs-accordion__content"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{
                    height: ready ? expandedHeight : 'auto',
                    opacity: 1,
                  }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.3, ease: [0.25, 0.4, 0.25, 1] }}
                >
                  <div className="docs-accordion__pages">
                    {section.pages.map((page) => (
                      <a
                        key={page.slug}
                        href={`/docs/${section.id}/${page.slug}`}
                        className="docs-accordion__page"
                      >
                        <span className="docs-accordion__page-title">{page.title}</span>
                        <span className="docs-accordion__page-desc">{page.description}</span>
                      </a>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
}
