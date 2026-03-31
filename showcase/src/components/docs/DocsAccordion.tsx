'use client';

import { useState } from 'react';
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

  return (
    <div className="docs-accordion">
      {sections.map((section) => {
        const isOpen = openId === section.id;

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
