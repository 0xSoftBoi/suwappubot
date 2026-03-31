'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { prepare, layout, type PreparedText } from '@chenglou/pretext';

type AccordionItem = {
  id: string;
  content: string;
  font: string;
};

type AccordionMeasurement = {
  id: string;
  expandedHeight: number;
};

export function usePretextAccordion(
  items: AccordionItem[],
  contentWidth: number,
  lineHeight: number,
) {
  const [measurements, setMeasurements] = useState<Map<string, number>>(new Map());
  const [ready, setReady] = useState(false);
  const preparedCache = useRef<Map<string, PreparedText>>(new Map());

  const measure = useCallback((width: number) => {
    if (items.length === 0 || width <= 0) return;

    const results = new Map<string, number>();

    items.forEach(({ id, content, font }) => {
      const key = `${font}::${content}`;
      let prepared = preparedCache.current.get(key);
      if (!prepared) {
        prepared = prepare(content, font);
        preparedCache.current.set(key, prepared);
      }
      const result = layout(prepared, width, lineHeight);
      results.set(id, result.height);
    });

    setMeasurements(results);
    setReady(true);
  }, [items, lineHeight]);

  useEffect(() => {
    if (contentWidth <= 0) return;
    document.fonts.ready.then(() => measure(contentWidth));
  }, [contentWidth, measure]);

  return { measurements, ready, remeasure: measure };
}
