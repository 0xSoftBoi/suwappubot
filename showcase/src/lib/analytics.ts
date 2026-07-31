/**
 * Lightweight client-side event tracking.
 *
 * Fires to whichever analytics provider Analytics.tsx loaded (Plausible or
 * Google Analytics), if any. Safe to call when no provider is configured -
 * it simply no-ops, so funnel instrumentation can ship before analytics is
 * switched on (set NEXT_PUBLIC_ANALYTICS_ID to enable).
 *
 * Also forwards conversion events to any active ad pixels (X / Reddit: see
 * Analytics.tsx) via CONVERSION_EVENTS below.
 */
type EventProps = Record<string, string | number | boolean>;

interface PlausibleWindow extends Window {
  plausible?: (event: string, opts?: { props?: EventProps }) => void;
  gtag?: (command: 'event', event: string, params?: EventProps) => void;
  twq?: (command: 'event', eventId: string, params?: EventProps) => void;
  rdt?: (command: 'track', eventName: string, params?: EventProps) => void;
}

// Events worth reporting to ad platforms as conversions, mapped to each
// pixel's own event vocabulary. Extend as new funnel steps get instrumented.
const CONVERSION_EVENTS: Record<string, { x?: string; reddit?: string }> = {
  mobile_waitlist_submitted: { x: 'tw-signup', reddit: 'SignUp' },
  enterprise_lead_submitted: { x: 'tw-lead', reddit: 'Lead' },
  contact_sales_submitted: { x: 'tw-lead', reddit: 'Lead' },
  newsletter_subscribed: { x: 'tw-signup', reddit: 'SignUp' },
  demo_call_click: { reddit: 'Lead' },
};

export function track(event: string, props?: EventProps): void {
  if (typeof window === 'undefined') return;
  const w = window as PlausibleWindow;
  try {
    w.plausible?.(event, props ? { props } : undefined);
    w.gtag?.('event', event, props);

    const conversion = CONVERSION_EVENTS[event];
    if (conversion?.x) w.twq?.('event', conversion.x, props);
    if (conversion?.reddit) w.rdt?.('track', conversion.reddit, props);
  } catch {
    // Analytics must never break the page.
  }
}
