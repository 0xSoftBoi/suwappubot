'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { prepare, layout, type PreparedText } from '@chenglou/pretext';

type MasonryItem = {
  title: string;
  description: string;
  titleFont: string;
  bodyFont: string;
};

type MasonryMeasurement = {
  titleHeight: number;
  bodyHeight: number;
  totalHeight: number;
};

export function usePretextMasonry(
  items: MasonryItem[],
  containerWidth: number,
  cardPadding: number,
) {
  const [measurements, setMeasurements] = useState<MasonryMeasurement[]>([]);
  const [ready, setReady] = useState(false);
  const preparedCache = useRef<Map<string, PreparedText>>(new Map());

  const measure = useCallback((width: number) => {
    if (items.length === 0 || width <= 0) return;

    const contentWidth = width - cardPadding * 2;

    const results: MasonryMeasurement[] = items.map(({ title, description, titleFont, bodyFont }) => {
      const titleKey = `${titleFont}::${title}`;
      let preparedTitle = preparedCache.current.get(titleKey);
      if (!preparedTitle) {
        preparedTitle = prepare(title, titleFont);
        preparedCache.current.set(titleKey, preparedTitle);
      }

      const bodyKey = `${bodyFont}::${description}`;
      let preparedBody = preparedCache.current.get(bodyKey);
      if (!preparedBody) {
        preparedBody = prepare(description, bodyFont);
        preparedCache.current.set(bodyKey, preparedBody);
      }

      const titleResult = layout(preparedTitle, contentWidth, 28);
      const bodyResult = layout(preparedBody, contentWidth, 24);

      return {
        titleHeight: titleResult.height,
        bodyHeight: bodyResult.height,
        totalHeight: titleResult.height + bodyResult.height + cardPadding * 2 + 60, // padding + icon + gaps
      };
    });

    setMeasurements(results);
    setReady(true);
  }, [items, cardPadding]);

  useEffect(() => {
    if (containerWidth <= 0) return;
    document.fonts.ready.then(() => measure(containerWidth));
  }, [containerWidth, measure]);

  return { measurements, ready, remeasure: measure };
}
