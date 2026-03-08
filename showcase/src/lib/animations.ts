/**
 * Shared Framer Motion animation variants and presets for the Suwappu showcase.
 *
 * Usage:
 *   import { fadeInUp, staggerContainer, transitions, viewportSettings } from '@/lib/animations';
 *
 *   <motion.div variants={staggerContainer} initial="hidden" whileInView="visible" viewport={viewportSettings.default}>
 *     <motion.p variants={fadeInUp}>Hello</motion.p>
 *   </motion.div>
 */

import type { Variants, Transition, UseInViewOptions } from 'framer-motion';

// ---------------------------------------------------------------------------
// Custom easing curves
// ---------------------------------------------------------------------------

/** Smooth deceleration curve - default for most animations */
export const EASE_OUT_EXPO: [number, number, number, number] = [0.22, 1, 0.36, 1];

/** Slight overshoot - good for elements that "land" */
export const EASE_SPRING: [number, number, number, number] = [0.34, 1.56, 0.64, 1];

/** Bounce easing - playful, use sparingly */
export const EASE_BOUNCE: [number, number, number, number] = [0.68, -0.55, 0.265, 1];

/** Smooth ease in-out */
export const EASE_SMOOTH: [number, number, number, number] = [0.4, 0, 0.2, 1];

// ---------------------------------------------------------------------------
// Transition presets
// ---------------------------------------------------------------------------

export const transitions = {
  /** Default smooth transition */
  default: {
    duration: 0.55,
    ease: EASE_OUT_EXPO,
  } satisfies Transition,

  /** Fast micro-interaction */
  fast: {
    duration: 0.25,
    ease: EASE_OUT_EXPO,
  } satisfies Transition,

  /** Slow entrance for hero elements */
  slow: {
    duration: 0.8,
    ease: EASE_OUT_EXPO,
  } satisfies Transition,

  /** Spring physics - natural bounce */
  spring: {
    type: 'spring' as const,
    stiffness: 300,
    damping: 24,
    mass: 0.8,
  } satisfies Transition,

  /** Gentle spring - larger elements */
  springGentle: {
    type: 'spring' as const,
    stiffness: 200,
    damping: 30,
    mass: 1,
  } satisfies Transition,

  /** Bouncy spring - playful elements */
  springBouncy: {
    type: 'spring' as const,
    stiffness: 400,
    damping: 15,
    mass: 0.5,
  } satisfies Transition,

  /** Smooth ease for opacity-only transitions */
  fade: {
    duration: 0.4,
    ease: EASE_SMOOTH,
  } satisfies Transition,

  /** Long transition for background/gradient animations */
  gradient: {
    duration: 1.2,
    ease: EASE_SMOOTH,
  } satisfies Transition,
} as const;

// ---------------------------------------------------------------------------
// Viewport / inView settings
// ---------------------------------------------------------------------------

export const viewportSettings = {
  /** Default: trigger once when 20% visible */
  default: {
    once: true,
    amount: 0.2,
  } satisfies UseInViewOptions,

  /** Eager: trigger when just entering viewport */
  eager: {
    once: true,
    amount: 0.05,
  } satisfies UseInViewOptions,

  /** Half: trigger when 50% visible */
  half: {
    once: true,
    amount: 0.5,
  } satisfies UseInViewOptions,

  /** Repeat: re-triggers every time element enters/exits */
  repeat: {
    once: false,
    amount: 0.2,
  } satisfies UseInViewOptions,

  /** With negative margin to trigger before visible */
  preload: {
    once: true,
    amount: 0.1,
    margin: '0px 0px -100px 0px',
  } satisfies UseInViewOptions,
} as const;

/** Legacy alias used by existing components */
export const viewportOnce = { once: true, margin: '-80px' as const };

// ---------------------------------------------------------------------------
// Directional fade variants
// ---------------------------------------------------------------------------

/**
 * Fade in from below. Supports a custom delay multiplier.
 *
 *   <motion.div variants={fadeInUp} custom={2} />  // delay = 2 * 0.08s
 */
export const fadeInUp: Variants = {
  hidden: { opacity: 0, y: 24 },
  visible: (d: number = 0) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.55, delay: d * 0.08, ease: EASE_OUT_EXPO },
  }),
};

/** Legacy alias - matches the name used in page.tsx */
export const fadeUp = fadeInUp;

/** Fade in from above */
export const fadeInDown: Variants = {
  hidden: { opacity: 0, y: -24 },
  visible: (d: number = 0) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.55, delay: d * 0.08, ease: EASE_OUT_EXPO },
  }),
};

/** Fade in from the left */
export const fadeInLeft: Variants = {
  hidden: { opacity: 0, x: -32 },
  visible: (d: number = 0) => ({
    opacity: 1,
    x: 0,
    transition: { duration: 0.55, delay: d * 0.08, ease: EASE_OUT_EXPO },
  }),
};

/** Fade in from the right */
export const fadeInRight: Variants = {
  hidden: { opacity: 0, x: 32 },
  visible: (d: number = 0) => ({
    opacity: 1,
    x: 0,
    transition: { duration: 0.55, delay: d * 0.08, ease: EASE_OUT_EXPO },
  }),
};

// ---------------------------------------------------------------------------
// Scale variants
// ---------------------------------------------------------------------------

/** Scale up from slightly smaller with fade */
export const scaleIn: Variants = {
  hidden: { opacity: 0, scale: 0.9 },
  visible: (d: number = 0) => ({
    opacity: 1,
    scale: 1,
    transition: { duration: 0.5, delay: d * 0.08, ease: EASE_OUT_EXPO },
  }),
};

/** Fade + scale + translate (matches the hero terminal animation in page.tsx) */
export const fadeInScale: Variants = {
  hidden: { opacity: 0, y: 30, scale: 0.97 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.7, delay: 0.3, ease: EASE_OUT_EXPO },
  },
};

/** Pop in with spring physics */
export const popIn: Variants = {
  hidden: { opacity: 0, scale: 0.8 },
  visible: {
    opacity: 1,
    scale: 1,
    transition: {
      type: 'spring',
      stiffness: 300,
      damping: 20,
    },
  },
};

// ---------------------------------------------------------------------------
// Slide variants
// ---------------------------------------------------------------------------

/** Slide in from below (larger offset than fadeInUp) */
export const slideIn: Variants = {
  hidden: { y: 60, opacity: 0 },
  visible: (d: number = 0) => ({
    y: 0,
    opacity: 1,
    transition: { duration: 0.6, delay: d * 0.1, ease: EASE_OUT_EXPO },
  }),
};

/** Slide in from the left */
export const slideInLeft: Variants = {
  hidden: { x: -60, opacity: 0 },
  visible: (d: number = 0) => ({
    x: 0,
    opacity: 1,
    transition: { duration: 0.6, delay: d * 0.1, ease: EASE_OUT_EXPO },
  }),
};

/** Slide in from the right */
export const slideInRight: Variants = {
  hidden: { x: 60, opacity: 0 },
  visible: (d: number = 0) => ({
    x: 0,
    opacity: 1,
    transition: { duration: 0.6, delay: d * 0.1, ease: EASE_OUT_EXPO },
  }),
};

// ---------------------------------------------------------------------------
// Stagger containers
// ---------------------------------------------------------------------------

/**
 * Container that staggers children.
 *
 *   <motion.div variants={staggerContainer}>
 *     <motion.div variants={fadeInUp} />
 *     <motion.div variants={fadeInUp} />
 *   </motion.div>
 */
export const staggerContainer: Variants = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.09,
    },
  },
};

/** Legacy alias - matches the name used in page.tsx */
export const stagger = staggerContainer;

/** Faster stagger for lists / grids with many items */
export const staggerContainerFast: Variants = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.05,
    },
  },
};

/** Slower stagger for hero sections with few items */
export const staggerContainerSlow: Variants = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.15,
    },
  },
};

// ---------------------------------------------------------------------------
// Stagger children (simple default for use inside stagger containers)
// ---------------------------------------------------------------------------

/** Basic stagger child: fades up */
export const staggerChild: Variants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, ease: EASE_OUT_EXPO },
  },
};

/** Stagger child that scales in */
export const staggerChildScale: Variants = {
  hidden: { opacity: 0, scale: 0.9, y: 10 },
  visible: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: { duration: 0.45, ease: EASE_OUT_EXPO },
  },
};

// ---------------------------------------------------------------------------
// Hover / tap interaction presets
// ---------------------------------------------------------------------------

/** Subtle lift on hover, shrink on tap */
export const hoverLift = {
  whileHover: { y: -4, transition: transitions.fast },
  whileTap: { scale: 0.98, transition: transitions.fast },
} as const;

/** Scale up on hover */
export const hoverScale = {
  whileHover: { scale: 1.05, transition: transitions.spring },
  whileTap: { scale: 0.97, transition: transitions.fast },
} as const;

/** Glow + lift on hover (pair with shadow-suwappu-card / shadow-suwappu-card-hover classes) */
export const hoverGlow = {
  whileHover: {
    y: -6,
    boxShadow: '0 12px 40px rgba(108,52,131,0.12), 0 4px 12px rgba(0,0,0,0.06)',
    transition: transitions.default,
  },
  whileTap: { scale: 0.98, transition: transitions.fast },
} as const;

// ---------------------------------------------------------------------------
// Page / section transition (for AnimatePresence)
// ---------------------------------------------------------------------------

export const pageTransition: Variants = {
  initial: { opacity: 0, y: 12 },
  animate: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, ease: EASE_OUT_EXPO },
  },
  exit: {
    opacity: 0,
    y: -12,
    transition: { duration: 0.3, ease: EASE_SMOOTH },
  },
};

// ---------------------------------------------------------------------------
// Legacy transition aliases (backwards compatibility)
// ---------------------------------------------------------------------------

export const springTransition: Transition = transitions.spring;
export const smoothEase: Transition = transitions.default;

// ---------------------------------------------------------------------------
// Utility: create a delayed variant from any base variant
// ---------------------------------------------------------------------------

/**
 * Returns a new Variants object with added base delay.
 *
 *   const delayedFadeUp = withDelay(fadeInUp, 0.3);
 */
export function withDelay(variants: Variants, baseDelay: number): Variants {
  return {
    ...variants,
    visible:
      typeof variants.visible === 'function'
        ? (d: number = 0) => {
            const result = (variants.visible as (d: number) => Record<string, unknown>)(d);
            return {
              ...result,
              transition: {
                ...(result.transition as Record<string, unknown>),
                delay:
                  ((result.transition as Record<string, unknown>)?.delay as number ?? 0) +
                  baseDelay,
              },
            };
          }
        : {
            ...(variants.visible as Record<string, unknown>),
            transition: {
              ...((variants.visible as Record<string, unknown>)?.transition as Record<
                string,
                unknown
              >),
              delay:
                (((variants.visible as Record<string, unknown>)?.transition as Record<
                  string,
                  unknown
                >)?.delay as number ?? 0) + baseDelay,
            },
          },
  };
}
