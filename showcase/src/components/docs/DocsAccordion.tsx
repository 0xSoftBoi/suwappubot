'use client';

import { useState, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

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
  const headerRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent, index: number) => {
      let targetIndex: number | null = null;

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          targetIndex = (index + 1) % sections.length;
          break;
        case 'ArrowUp':
          e.preventDefault();
          targetIndex = (index - 1 + sections.length) % sections.length;
          break;
        case 'Home':
          e.preventDefault();
          targetIndex = 0;
          break;
        case 'End':
          e.preventDefault();
          targetIndex = sections.length - 1;
          break;
      }

      if (targetIndex !== null) {
        const targetId = sections[targetIndex].id;
        headerRefs.current.get(targetId)?.focus();
      }
    },
    [sections],
  );

  return (
    <div className="docs-accordion" role="presentation">
      {sections.map((section, index) => {
        const isOpen = openId === section.id;
        const panelId = `accordion-panel-${section.id}`;
        const headerId = `accordion-header-${section.id}`;

        return (
          <div key={section.id} id={section.id} className="docs-accordion__item">
            <h3 className="docs-accordion__title">
              <button
                id={headerId}
                ref={(el) => { if (el) headerRefs.current.set(section.id, el); }}
                className={`docs-accordion__header ${isOpen ? 'docs-accordion__header--open' : ''}`}
                onClick={() => setOpenId(isOpen ? null : section.id)}
                onKeyDown={(e) => handleKeyDown(e, index)}
                aria-expanded={isOpen}
                aria-controls={panelId}
              >
                <div>
                  <span className="docs-accordion__heading">{section.title}</span>
                  <span className="docs-accordion__meta">
                    {section.pages.length} {section.pages.length === 1 ? 'page' : 'pages'}
                  </span>
                </div>
                <motion.span
                  className="docs-accordion__chevron"
                  animate={{ rotate: isOpen ? 180 : 0 }}
                  transition={{ duration: 0.2 }}
                  aria-hidden="true"
                >
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                    <path d="M5 8l5 5 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </motion.span>
              </button>
            </h3>

            <AnimatePresence initial={false}>
              {isOpen && (
                <motion.div
                  id={panelId}
                  role="region"
                  aria-labelledby={headerId}
                  className="docs-accordion__content"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
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
