/**
 * Adaptive render budget (W4.3).
 *
 * Tektonic's site keeps a canvas fluid simulation at 60fps across device tiers by
 * measuring, not guessing: every 60 frames it takes the average frame time and grows
 * the simulation's cell size when that average exceeds 18ms, shrinks it when it drops
 * below 12ms. The band between the two thresholds is what stops the controller
 * oscillating — a single threshold makes quality flap on every frame near the boundary.
 *
 * Why this matters here more than it did for them: most of our traffic is a Telegram
 * Mini App on a mid-range phone. A hero that holds 60fps on the laptop it was built on
 * and runs at 22fps in the user's hand is not a fast hero, and nobody sees the 22fps
 * unless something measures it.
 *
 * This is deliberately framework-free — no React state, no hooks. Every canvas
 * component on this site drives an imperative RAF loop inside a `useEffect` closure,
 * and pushing frame timings through React state would cause exactly the re-renders the
 * measurement is trying to protect.
 *
 *   const budget = createFrameBudget({ min: 0.5, max: 2 });
 *   const draw = () => {
 *     budget.mark();                        // once per frame
 *     drawScene(count * budget.quality);    // scale whatever is expensive
 *     raf = requestAnimationFrame(draw);
 *   };
 */

export interface FrameBudgetOptions {
  /** Frames between reassessments. Tektonic use 60; ~1s at target framerate. */
  sampleSize?: number;
  /** Average frame time above which the scene is too expensive (ms). */
  coarsenAboveMs?: number;
  /** Average frame time below which there is headroom to spare (ms). */
  refineBelowMs?: number;
  /** Lower bound on the quality multiplier — never degrade past recognisable. */
  min?: number;
  /** Upper bound on the quality multiplier. */
  max?: number;
  /** Starting multiplier. */
  initial?: number;
  /** Multiplicative step per adjustment. */
  step?: number;
  /** Called whenever quality changes, for components that must rebuild buffers. */
  onChange?: (quality: number, averageMs: number) => void;
}

export interface FrameBudget {
  /** Call exactly once per rendered frame. */
  mark(): void;
  /** Current quality multiplier. Scale particle counts, grid density, iterations. */
  readonly quality: number;
  /** Average frame time of the last completed sample window, in ms. */
  readonly averageMs: number;
  /** True while the controller has not yet completed its first window. */
  readonly warmingUp: boolean;
  /** Discard in-flight timings — call after a resize or a tab becomes visible. */
  reset(): void;
}

const DEFAULTS: Required<Omit<FrameBudgetOptions, 'onChange'>> = {
  sampleSize: 60,
  coarsenAboveMs: 18,
  refineBelowMs: 12,
  min: 0.35,
  max: 1,
  initial: 1,
  step: 0.15,
};

export function createFrameBudget(options: FrameBudgetOptions = {}): FrameBudget {
  const o = { ...DEFAULTS, ...options };
  const onChange = options.onChange;

  let quality = clamp(o.initial, o.min, o.max);
  let averageMs = 0;
  let frames = 0;
  let accumulated = 0;
  let last = 0;
  let warmingUp = true;

  const now = () =>
    typeof performance !== 'undefined' ? performance.now() : Date.now();

  return {
    mark() {
      const t = now();
      if (last !== 0) {
        const delta = t - last;
        // A frame longer than a quarter second is a tab switch, a GC pause or a
        // breakpoint, not a rendering cost. Folding it into the average would
        // permanently degrade quality for a stall that already ended.
        if (delta < 250) {
          accumulated += delta;
          frames++;
        }
      }
      last = t;

      if (frames < o.sampleSize) return;

      averageMs = accumulated / frames;
      accumulated = 0;
      frames = 0;
      warmingUp = false;

      const previous = quality;
      if (averageMs > o.coarsenAboveMs) {
        quality = clamp(quality - o.step, o.min, o.max);
      } else if (averageMs < o.refineBelowMs) {
        quality = clamp(quality + o.step, o.min, o.max);
      }
      // Between refineBelowMs and coarsenAboveMs nothing happens. That dead band is
      // the whole reason this converges instead of oscillating.

      if (quality !== previous) onChange?.(quality, averageMs);
    },

    get quality() {
      return quality;
    },
    get averageMs() {
      return averageMs;
    },
    get warmingUp() {
      return warmingUp;
    },

    reset() {
      accumulated = 0;
      frames = 0;
      last = 0;
    },
  };
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/**
 * Pause a RAF loop while the tab is hidden (W4.4).
 *
 * A background tab still runs a canvas loop in some browsers, and even when it is
 * throttled it keeps the compositor and the JS thread alive on someone's battery.
 * Checking `document.hidden` inside the frame costs one property read.
 *
 * Returns a detach function; the loop restarts through `onResume` so callers can also
 * reset their frame budget, whose timings are meaningless across a hidden period.
 */
export function pauseWhenHidden(onResume: () => void): () => void {
  if (typeof document === 'undefined') return () => {};
  const handler = () => {
    if (!document.hidden) onResume();
  };
  document.addEventListener('visibilitychange', handler);
  return () => document.removeEventListener('visibilitychange', handler);
}
