'use client';

import { useRef } from 'react';
import { motion, useInView } from 'framer-motion';
import docsData from '../data/docs.json';

const SECTION_ICONS: Record<string, string> = {
  'quick-start': 'QS',
  'authentication': 'AK',
  'api-reference': 'EP',
  'protocols': 'A2',
  'chains-reference': 'CH',
  'guides': 'GD',
};

const staggerContainer = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.08 } },
};

const staggerItem = {
  hidden: { opacity: 0, y: 24 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.25, 0.4, 0.25, 1] } },
};

export default function DocsMasonry() {
  const containerRef = useRef<HTMLDivElement>(null);
  const inView = useInView(containerRef, { once: true, margin: '-80px' });

  return (
    <section className="section">
      <motion.div
        initial={{ opacity: 0, y: 32 }}
        animate={inView ? { opacity: 1, y: 0 } : { opacity: 0, y: 32 }}
        transition={{ duration: 0.6, ease: [0.25, 0.4, 0.25, 1] }}
      >
        <p className="section__label">Documentation</p>
        <h2 className="section__heading">Everything you need to build.</h2>
        <p className="section__body">
          From your first swap to production trading bots. Guides, API reference, and protocol specs.
        </p>
      </motion.div>

      <motion.div
        ref={containerRef}
        className="docs-masonry"
        initial="hidden"
        animate={inView ? 'visible' : 'hidden'}
        variants={staggerContainer}
      >
        {docsData.sections.map((section) => (
          <motion.a
            key={section.id}
            href={`/docs#${section.id}`}
            className="docs-masonry__card"
            variants={staggerItem}
            whileHover={{ y: -4, borderColor: 'var(--suwappu-summer-accent)' }}
          >
            <div className="docs-masonry__icon">
              {SECTION_ICONS[section.id] || section.title[0]}
            </div>
            <h3 className="docs-masonry__title">{section.title}</h3>
            <p className="docs-masonry__desc">
              {section.pages.length > 0 ? section.pages[0].description : ''}
            </p>
            <span className="docs-masonry__count">
              {section.pages.length} {section.pages.length === 1 ? 'page' : 'pages'}
            </span>
          </motion.a>
        ))}
      </motion.div>
    </section>
  );
}
