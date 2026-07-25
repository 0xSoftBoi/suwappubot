'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import styles from './FaqAccordion.module.css';

export type FaqItem = { q: string; a: string };

/**
 * Generic single-open FAQ accordion. Used on the /agents landing page —
 * follows the same expand/collapse + chevron-rotate pattern as
 * components/docs/DocsAccordion.tsx, but for flat Q/A pairs instead of
 * doc-section trees.
 */
export default function FaqAccordion({ items }: { items: FaqItem[] }) {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  return (
    <div className={`faq-accordion ${styles.wrap}`}>
      {items.map((item, i) => {
        const isOpen = openIndex === i;
        const panelId = `faq-panel-${i}`;
        const headerId = `faq-header-${i}`;
        return (
          <div className={`faq-accordion__item${isOpen ? ' faq-accordion__item--open' : ''}`} key={item.q}>
            <h3 className="faq-accordion__title">
              <button
                id={headerId}
                className="faq-accordion__header"
                onClick={() => setOpenIndex(isOpen ? null : i)}
                aria-expanded={isOpen}
                aria-controls={panelId}
              >
                <span>{item.q}</span>
                <motion.span
                  className="faq-accordion__chevron"
                  animate={{ rotate: isOpen ? 180 : 0 }}
                  transition={{ duration: 0.2 }}
                  aria-hidden="true"
                >
                  <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
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
                  className="faq-accordion__content"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.25, ease: [0.25, 0.4, 0.25, 1] }}
                >
                  <p className="faq-accordion__answer">{item.a}</p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
}
