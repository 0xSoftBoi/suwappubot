'use client';

import { useRef, useState, useEffect, useCallback } from 'react';
import { motion, useInView } from 'framer-motion';
import { usePretextMasonry } from '../lib/pretext/usePretextMasonry';
import { FONTS } from '../lib/pretext/pretextFonts';
import docsData from '../data/docs.json';

const SECTION_ICONS: Record<string, string> = {
  'quick-start': 'QS',
  'authentication': 'AK',
  'api-reference': 'EP',
  'protocols': 'A2',
  'chains-reference': 'CH',
  'guides': 'GD',
};

const CARD_PADDING = 32;

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
  const [containerWidth, setContainerWidth] = useState(0);

  // Measure container width
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      // Approximate single card width in a 3-col grid
      const gap = 24;
      const cols = width > 768 ? 3 : width > 480 ? 2 : 1;
      const cardWidth = (width - gap * (cols - 1)) / cols;
      setContainerWidth(cardWidth);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const masonryItems = docsData.sections.map((section) => ({
    title: section.title,
    description: section.pages.length > 0 ? section.pages[0].description : '',
    titleFont: FONTS.display.regular,
    bodyFont: FONTS.body.regular,
  }));

  const { measurements, ready } = usePretextMasonry(masonryItems, containerWidth, CARD_PADDING);

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
        animate={inView && ready ? 'visible' : 'hidden'}
        variants={staggerContainer}
      >
        {docsData.sections.map((section, i) => {
          const height = measurements[i]?.totalHeight;
          return (
            <motion.a
              key={section.id}
              href={`/docs#${section.id}`}
              className="docs-masonry__card"
              variants={staggerItem}
              whileHover={{ y: -4, borderColor: '#f472b6' }}
              style={height ? { minHeight: height } : undefined}
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
          );
        })}
      </motion.div>
    </section>
  );
}
