'use client';

import { useEffect } from 'react';
import { captureAttribution } from '@/lib/attribution';

/**
 * Fires first-touch UTM/referrer capture once on mount. Rendered from the
 * root layout: no visual output, just the side effect. Kept as its own
 * tiny client component so the root layout can stay a server component
 * (App Router: useSearchParams/window access needs a client boundary).
 */
export default function AttributionCapture() {
  useEffect(() => {
    captureAttribution();
  }, []);

  return null;
}
