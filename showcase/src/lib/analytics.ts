/**
 * Lightweight client-side event tracking.
 *
 * Fires to whichever analytics provider Analytics.tsx loaded (Plausible or
 * Google Analytics), if any. Safe to call when no provider is configured —
 * it simply no-ops, so funnel instrumentation can ship before analytics is
 * switched on (set NEXT_PUBLIC_ANALYTICS_ID to enable).
 */
type EventProps = Record<string, string | number | boolean>;

interface PlausibleWindow extends Window {
  plausible?: (event: string, opts?: { props?: EventProps }) => void;
  gtag?: (command: 'event', event: string, params?: EventProps) => void;
}

export function track(event: string, props?: EventProps): void {
  if (typeof window === 'undefined') return;
  const w = window as PlausibleWindow;
  try {
    w.plausible?.(event, props ? { props } : undefined);
    w.gtag?.('event', event, props);
  } catch {
    // Analytics must never break the page.
  }
}
