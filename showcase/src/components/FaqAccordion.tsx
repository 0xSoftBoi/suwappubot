'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

export type FaqItem = { q: string; a: string };

/**
 * Generic single-open FAQ accordion, styled on the Phase 1 dark system
 * (Tailwind utilities + --canvas/--ink/--accent tokens). Used on /agents
 * and /pricing.
 */
export default function FaqAccordion({ items }: { items: FaqItem[] }) {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  return (
    <div className="divide-y divide-white/10 rounded-card border border-white/10 bg-[var(--canvas-2)]">
      {items.map((item, i) => {
        const isOpen = openIndex === i;
        const panelId = `faq-panel-${i}`;
        const headerId = `faq-header-${i}`;
        return (
          <div key={item.q}>
            <h3 className="m-0">
              <button
                id={headerId}
                className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left text-sm font-medium text-[var(--ink-0)] transition-colors hover:bg-white/5 md:text-base"
                onClick={() => setOpenIndex(isOpen ? null : i)}
                aria-expanded={isOpen}
                aria-controls={panelId}
              >
                <span>{item.q}</span>
                <motion.span
                  className="shrink-0 text-[var(--ink-1)]"
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
                  className="overflow-hidden"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.25, ease: [0.25, 0.4, 0.25, 1] }}
                >
                  <p className="px-5 pb-5 text-sm leading-relaxed text-[var(--ink-1)]">{item.a}</p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
}
