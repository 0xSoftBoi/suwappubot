'use client';

import { useRef, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { prepare, layoutWithLines, type PreparedTextWithSegments } from '@chenglou/pretext';
import { FONTS } from '../../lib/pretext/pretextFonts';

type Props = {
  html: string;
  title: string;
};

export default function DocsReader({ html, title }: Props) {
  const readerRef = useRef<HTMLDivElement>(null);
  const [pretextReady, setPretextReady] = useState(false);

  // Use pretext to measure and optimize code block heights
  useEffect(() => {
    const el = readerRef.current;
    if (!el) return;

    document.fonts.ready.then(() => {
      // Measure all code blocks for accurate height
      const codeBlocks = el.querySelectorAll('pre code');
      codeBlocks.forEach((block) => {
        const text = block.textContent ?? '';
        if (!text) return;

        const parentPre = block.parentElement;
        if (!parentPre) return;

        const width = parentPre.clientWidth - 40; // subtract padding
        if (width <= 0) return;

        try {
          const prepared = prepare(text, FONTS.mono.small);
          const result = layoutWithLines(prepared as PreparedTextWithSegments, width, 22);
          parentPre.style.minHeight = `${result.height + 40}px`; // add padding
        } catch {
          // Pretext may fail on some content — gracefully degrade
        }
      });

      setPretextReady(true);
    });
  }, [html]);

  return (
    <motion.div
      ref={readerRef}
      className="doc-reader"
      initial={{ opacity: 0 }}
      animate={{ opacity: pretextReady ? 1 : 0.6 }}
      transition={{ duration: 0.3 }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
