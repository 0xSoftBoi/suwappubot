/**
 * Reduced-motion preference, live (W4.5).
 *
 * Every canvas component on this site reads the preference exactly once:
 *
 *     const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
 *
 * That is a snapshot. A visitor who turns motion sensitivity on — because our animation
 * is the thing making them ill — keeps getting the animation until they reload, which is
 * the one moment the setting most needs to take effect. Tektonic call this out
 * explicitly: "live listener support for immediate effect without reload."
 *
 * `subscribeMotionPreference` gives the same one-line read plus a callback, so an
 * imperative RAF loop can stop mid-flight.
 *
 *   const motion = subscribeMotionPreference((reduce) => {
 *     if (reduce) cancelAnimationFrame(raf);
 *     else raf = requestAnimationFrame(draw);
 *   });
 *   // ...
 *   return () => motion.detach();
 */

const QUERY = '(prefers-reduced-motion: reduce)';

export interface MotionPreference {
  /** Whether the user currently prefers reduced motion. */
  readonly reduce: boolean;
  /** Stop listening. Always call this from the effect's cleanup. */
  detach(): void;
}

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia(QUERY).matches;
}

export function subscribeMotionPreference(
  onChange: (reduce: boolean) => void,
): MotionPreference {
  if (typeof window === 'undefined' || !window.matchMedia) {
    return { reduce: false, detach() {} };
  }

  const mql = window.matchMedia(QUERY);
  let reduce = mql.matches;

  const handler = (event: MediaQueryListEvent) => {
    if (event.matches === reduce) return;
    reduce = event.matches;
    onChange(reduce);
  };

  // Safari below 14 only has the deprecated addListener form, and this site is served
  // to whatever phone the Telegram client is embedded in.
  if (typeof mql.addEventListener === 'function') {
    mql.addEventListener('change', handler);
  } else {
    (mql as MediaQueryList & { addListener(cb: (e: MediaQueryListEvent) => void): void }).addListener(handler);
  }

  return {
    get reduce() {
      return reduce;
    },
    detach() {
      if (typeof mql.removeEventListener === 'function') {
        mql.removeEventListener('change', handler);
      } else {
        (mql as MediaQueryList & { removeListener(cb: (e: MediaQueryListEvent) => void): void }).removeListener(handler);
      }
    },
  };
}
