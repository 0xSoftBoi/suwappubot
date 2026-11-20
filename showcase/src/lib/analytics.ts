/**
 * Lightweight client-side event tracking.
 *
 * Fires to whichever analytics provider Analytics.tsx loaded (Plausible or
 * Google Analytics), if any. Safe to call when no provider is configured -
 * it simply no-ops, so funnel instrumentation can ship before analytics is
 * switched on (set NEXT_PUBLIC_ANALYTICS_ID to enable).
 *
 * Every event is also recorded first-party (see recordFirstParty) so the team's
 * own admin dashboard works without a third-party analytics login.
 *
 * Also forwards conversion events to any active ad pixels (X / Reddit: see
 * Analytics.tsx) via CONVERSION_EVENTS below.
 */
import { API_BASE_URL } from './links';

type EventProps = Record<string, string | number | boolean>;

const SESSION_KEY = 'suwappu_sid';

/** Random id for this tab-session. sessionStorage only: it is not a cookie,
 *  is not shared across tabs or visits, and cannot identify a person. */
function sessionId(): string | null {
  try {
    let sid = sessionStorage.getItem(SESSION_KEY);
    if (!sid) {
      const bytes = crypto.getRandomValues(new Uint8Array(12));
      sid = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
      sessionStorage.setItem(SESSION_KEY, sid);
    }
    return sid;
  } catch {
    return null; // storage blocked (private mode, strict settings)
  }
}

/**
 * First-party copy of every event, for the admin "Growth" dashboard
 * (api-ts POST /v1/web/event). Sends the event name, the page path (no query
 * string), the referring site's host and UTM tags. No cookies, no IP or
 * device data, nothing that identifies the visitor. Skipped when the browser
 * sends Do Not Track or Global Privacy Control.
 */
export function recordFirstParty(event: string, props?: EventProps): void {
  if (typeof window === 'undefined') return;
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
  if (nav.doNotTrack === '1' || nav.globalPrivacyControl) return;
  const sid = sessionId();
  if (!sid) return;

  let ref = '';
  try {
    if (document.referrer) {
      const host = new URL(document.referrer).hostname;
      if (host !== window.location.hostname) ref = host;
    }
  } catch { /* malformed referrer */ }

  const q = new URLSearchParams(window.location.search);
  const body = JSON.stringify({
    name: event,
    path: window.location.pathname,
    sid,
    ref,
    utm: {
      source: q.get('utm_source') ?? undefined,
      medium: q.get('utm_medium') ?? undefined,
      campaign: q.get('utm_campaign') ?? undefined,
    },
    props,
  });

  // text/plain keeps this a "simple" request: no CORS preflight per event.
  // keepalive lets it finish when the click navigates away.
  fetch(`${API_BASE_URL}/v1/web/event`, {
    method: 'POST',
    body,
    headers: { 'Content-Type': 'text/plain' },
    credentials: 'omit',
    keepalive: true,
  }).catch(() => { /* analytics must never surface an error */ });
}

interface PlausibleWindow extends Window {
  plausible?: (event: string, opts?: { props?: EventProps }) => void;
  gtag?: (command: 'event', event: string, params?: EventProps) => void;
  twq?: (command: 'event', eventId: string, params?: EventProps) => void;
  rdt?: (command: 'track', eventName: string, params?: EventProps) => void;
  posthog?: { capture?: (event: string, props?: EventProps) => void };
}

// Events worth reporting to ad platforms as conversions, mapped to each
// pixel's own event vocabulary. Extend as new funnel steps get instrumented.
const CONVERSION_EVENTS: Record<string, { x?: string; reddit?: string }> = {
  mobile_waitlist_submitted: { x: 'tw-signup', reddit: 'SignUp' },
  enterprise_lead_submitted: { x: 'tw-lead', reddit: 'Lead' },
  contact_sales_submitted: { x: 'tw-lead', reddit: 'Lead' },
  newsletter_subscribed: { x: 'tw-signup', reddit: 'SignUp' },
  waitlist_reserved: { x: 'tw-signup', reddit: 'SignUp' },
  demo_call_click: { reddit: 'Lead' },
};

export function track(event: string, props?: EventProps): void {
  if (typeof window === 'undefined') return;
  const w = window as PlausibleWindow;
  try {
    recordFirstParty(event, props);
    w.plausible?.(event, props ? { props } : undefined);
    w.gtag?.('event', event, props);
    w.posthog?.capture?.(event, props);

    const conversion = CONVERSION_EVENTS[event];
    if (conversion?.x) w.twq?.('event', conversion.x, props);
    if (conversion?.reddit) w.rdt?.('track', conversion.reddit, props);
  } catch {
    // Analytics must never break the page.
  }
}
