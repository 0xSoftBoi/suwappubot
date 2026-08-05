/**
 * First-touch marketing attribution capture.
 *
 * On first page load, snapshots UTM params, a `ref` param, and
 * document.referrer into localStorage. First-touch wins: once a value is
 * stored we never overwrite it, so the attribution reflects how the visitor
 * originally found Suwappu even if they browse around with different UTMs
 * later. Forms (waitlist, enterprise contact) read this back and include it
 * in their POST payload; harmless if the backend ignores it.
 */
const STORAGE_KEY = 'suwappu_attribution';

const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'] as const;

export interface Attribution {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_term?: string;
  utm_content?: string;
  ref?: string;
  referrer?: string;
  landing_page?: string;
  captured_at?: string;
  content_id?: string;
  creative_variant_id?: string;
}

/**
 * Reads the current URL + referrer and stores them as first-touch
 * attribution if nothing is stored yet. Safe to call on every page load -
 * it no-ops once attribution has already been captured.
 */
export function captureAttribution(): void {
  if (typeof window === 'undefined') return;
  try {
    if (window.localStorage.getItem(STORAGE_KEY)) return; // first-touch already captured

    const params = new URLSearchParams(window.location.search);
    const attribution: Attribution = {};

    for (const key of UTM_KEYS) {
      const value = params.get(key);
      if (value) attribution[key] = value;
    }
    for (const key of ['content_id', 'creative_variant_id'] as const) {
      const value = params.get(key);
      if (value) attribution[key] = value;
    }
    const ref = params.get('ref');
    if (ref) attribution.ref = ref;
    if (document.referrer) attribution.referrer = document.referrer;

    // Only bother storing if we actually captured something worth keeping.
    if (Object.keys(attribution).length === 0) return;

    attribution.landing_page = window.location.pathname;
    attribution.captured_at = new Date().toISOString();

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(attribution));
  } catch {
    // localStorage can throw in private-browsing / disabled-storage contexts.
  }
}

/** Reads the stored first-touch attribution object, if any. */
export function getAttribution(): Attribution | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as Attribution;
  } catch {
    return null;
  }
}
