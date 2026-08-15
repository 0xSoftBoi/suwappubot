'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { prepare, layout, type PreparedText, type LayoutResult } from '@chenglou/pretext';

type TextEntry = {
  text: string;
  font: string;
};

type MeasuredEntry = LayoutResult & {
  prepared: PreparedText;
};

export function usePretextLayout(
  entries: TextEntry[],
  maxWidth: number,
  lineHeight: number,
) {
  const [measurements, setMeasurements] = useState<MeasuredEntry[]>([]);
  const [ready, setReady] = useState(false);
  const preparedRef = useRef<Map<string, PreparedText>>(new Map());

  // Prepare + layout after fonts are loaded
  useEffect(() => {
    if (entries.length === 0 || maxWidth <= 0) return;

    let cancelled = false;

    document.fonts.ready.then(() => {
      if (cancelled) return;

      const results: MeasuredEntry[] = entries.map(({ text, font }) => {
        const key = `${font}::${text}`;
        let prepared = preparedRef.current.get(key);
        if (!prepared) {
          prepared = prepare(text, font);
          preparedRef.current.set(key, prepared);
        }
        const result = layout(prepared, maxWidth, lineHeight);
        return { ...result, prepared };
      });

      setMeasurements(results);
      setReady(true);
    });

    return () => { cancelled = true; };
  }, [entries, maxWidth, lineHeight]);

  // Re-layout only (no re-prepare) on width change
  const relayout = useCallback((newWidth: number) => {
    if (measurements.length === 0) return;

    const results = measurements.map((m) => {
      const result = layout(m.prepared, newWidth, lineHeight);
      return { ...result, prepared: m.prepared };
    });
    setMeasurements(results);
  }, [measurements, lineHeight]);

  return { measurements, ready, relayout };
}
