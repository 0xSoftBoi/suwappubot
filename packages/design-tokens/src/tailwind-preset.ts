/**
 * @suwappu/design-tokens — Tailwind CSS Presets
 *
 * Drop-in presets for Tailwind configs. Replaces manual color/shadow/font definitions.
 */

import { designTokens } from './tokens'

const t = designTokens

/**
 * Shared keyframes used by both presets.
 */
const sharedKeyframes = {
  'suwappu-petal-float': {
    '0%': { transform: 'translateY(0) translateX(0) rotate(0deg)', opacity: '0' },
    '10%': { opacity: '1' },
    '90%': { opacity: '1' },
    '100%': { transform: 'translateY(100vh) translateX(100px) rotate(360deg)', opacity: '0' },
  },
  'suwappu-petal-sway': {
    '0%, 100%': { transform: 'rotate(-5deg) scale(1)' },
    '50%': { transform: 'rotate(5deg) scale(1.05)' },
  },
  'suwappu-bounce': {
    '0%, 80%, 100%': { transform: 'translateY(0)' },
    '40%': { transform: 'translateY(-12px)' },
  },
  'suwappu-shimmer': {
    '0%': { backgroundPosition: '-200% 0' },
    '100%': { backgroundPosition: '200% 0' },
  },
  'suwappu-heart-burst': {
    '0%': { transform: 'scale(1)' },
    '25%': { transform: 'scale(1.3)' },
    '50%': { transform: 'scale(0.9)' },
    '75%': { transform: 'scale(1.1)' },
    '100%': { transform: 'scale(1)' },
  },
  'page-enter': {
    '0%': { opacity: '0', transform: 'translateY(8px)' },
    '100%': { opacity: '1', transform: 'translateY(0)' },
  },
  'toast-enter': {
    '0%': { opacity: '0', transform: 'translateY(-100%)' },
    '100%': { opacity: '1', transform: 'translateY(0)' },
  },
  'toast-exit': {
    '0%': { opacity: '1', transform: 'translateY(0)' },
    '100%': { opacity: '0', transform: 'translateY(-100%)' },
  },
  'suwappu-swap-flip': {
    '0%': { transform: 'rotateX(0deg)' },
    '50%': { transform: 'rotateX(90deg)' },
    '100%': { transform: 'rotateX(0deg)' },
  },
  'suwappu-price-tick-up': {
    '0%': { color: 'inherit' },
    '25%': { color: '#22C55E', backgroundColor: 'rgba(34, 197, 94, 0.1)' },
    '100%': { color: 'inherit', backgroundColor: 'transparent' },
  },
  'suwappu-price-tick-down': {
    '0%': { color: 'inherit' },
    '25%': { color: '#EF4444', backgroundColor: 'rgba(239, 68, 68, 0.1)' },
    '100%': { color: 'inherit', backgroundColor: 'transparent' },
  },
  'suwappu-pulse-pending': {
    '0%, 100%': { opacity: '1' },
    '50%': { opacity: '0.5' },
  },
  'suwappu-quote-shimmer': {
    '0%': { backgroundPosition: '-200% 0' },
    '100%': { backgroundPosition: '200% 0' },
  },
  'suwappu-slide-up': {
    from: { transform: 'translateY(100%)', opacity: '0' },
    to: { transform: 'translateY(0)', opacity: '1' },
  },
  'suwappu-number-spring': {
    '0%': { transform: 'scale(1)' },
    '40%': { transform: 'scale(1.08)' },
    '100%': { transform: 'scale(1)' },
  },
  // Terminal-specific
  'price-tick-up': {
    '0%': { color: 'inherit' },
    '50%': { color: '#22C55E' },
    '100%': { color: 'inherit' },
  },
  'price-tick-down': {
    '0%': { color: 'inherit' },
    '50%': { color: '#EF4444' },
    '100%': { color: 'inherit' },
  },
  shimmer: {
    '0%': { backgroundPosition: '-200% 0' },
    '100%': { backgroundPosition: '200% 0' },
  },
} as const

/**
 * Shared animations used by both presets.
 */
const sharedAnimations = {
  'suwappu-petal': 'suwappu-petal-float 8s ease-in-out infinite, suwappu-petal-sway 3s ease-in-out infinite',
  'suwappu-bounce': 'suwappu-bounce 1.4s ease-in-out infinite',
  'suwappu-shimmer': 'suwappu-shimmer 1.5s infinite',
  'suwappu-heart': 'suwappu-heart-burst 0.6s ease-in-out',
  'page-enter': 'page-enter 0.3s cubic-bezier(0.22, 1, 0.36, 1) both',
  'toast-enter': 'toast-enter 0.2s ease-out both',
  'toast-exit': 'toast-exit 0.2s ease-out both',
  'swap-flip': 'suwappu-swap-flip 200ms ease-out',
  'price-up': 'suwappu-price-tick-up 300ms ease',
  'price-down': 'suwappu-price-tick-down 300ms ease',
  'pulse-pending': 'suwappu-pulse-pending 2s ease-in-out infinite',
  'quote-shimmer': 'suwappu-quote-shimmer 1.5s ease-in-out infinite',
  'slide-up': 'suwappu-slide-up 300ms cubic-bezier(0.175,0.885,0.32,1.275)',
  'number-spring': 'suwappu-number-spring 400ms cubic-bezier(0.175,0.885,0.32,1.275)',
} as const

/**
 * Shared domain colors (chain, provider, impact, tx-state) used by both presets.
 */
const domainColors = {
  impact: t.colors.impact,
  'tx-state': t.colors.txState,
  chain: t.colors.chain,
  provider: t.colors.provider,
} as const

/**
 * Shared border-radius extensions used by both presets.
 */
const sharedBorderRadius = {
  'suwappu-sm': `${t.borderRadius.sm}px`,
  'suwappu-md': `${t.borderRadius.md}px`,
  'suwappu-lg': `${t.borderRadius.lg}px`,
  'suwappu-xl': `${t.borderRadius.xl}px`,
  'suwappu-xxl': `${t.borderRadius.xxl}px`,
  'suwappu-xxxl': `${t.borderRadius.xxxl}px`,
  'suwappu-pill': `${t.borderRadius.pill}px`,
} as const

/**
 * Shared box-shadow extensions used by both presets.
 */
const sharedBoxShadow = {
  'suwappu-1': t.shadows.level1,
  'suwappu-2': t.shadows.level2,
  'suwappu-3': t.shadows.level3,
  'suwappu-4': t.shadows.level4,
  'suwappu-glow': t.shadows.glow,
  'suwappu-button': t.shadows.buttonPrimary,
  'suwappu-button-hover': t.shadows.buttonHover,
} as const

/**
 * Sakura (consumer) Tailwind preset.
 *
 * Usage in tailwind.config:
 *   import { suwappuPreset } from '@suwappu/design-tokens/tailwind'
 *   export default { presets: [suwappuPreset], ... }
 */
/**
 * warmPreset — the CANONICAL Suwappu brand as a Tailwind preset.
 *
 * `showcase/` previously defined these values inline in its own tailwind config,
 * which made the public marketing site the only surface not consuming the token
 * package. Exported here so there is exactly one definition, and a test in
 * tests/test_brand_tokens.py fails if any surface drifts from it.
 *
 * suwappuPreset and professionalPreset below are the LEGACY identity, still
 * consumed by webapp/mobile/terminal. They are kept so that migration is a
 * visible, reviewable diff rather than a silent repaint of the product.
 */
export const warmPreset = {
  theme: {
    extend: {
      colors: {
        warm: {
          bg: designTokens.brand.bg,
          surface: designTokens.brand.surface,
          'surface-2': designTokens.brand.surface2,
          border: designTokens.brand.border,
          'border-2': designTokens.brand.border2,
          text: designTokens.brand.text,
          'text-2': designTokens.brand.text2,
          'text-3': designTokens.brand.text3,
          accent: designTokens.brand.accent,
          'accent-hover': designTokens.brand.accentHover,
          'accent-light': designTokens.brand.accentLight,
          green: designTokens.brand.green,
          'green-light': designTokens.brand.greenLight,
          dark: designTokens.brand.dark,
          'dark-surface': designTokens.brand.darkSurface,
        },
      },
      fontFamily: {
        display: ['var(--font-display)', 'Geist', 'system-ui', 'sans-serif'],
        sans: ['var(--font-sans)', 'Geist', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'Geist Mono', 'monospace'],
      },
      borderRadius: { pill: '50px', xl: '20px', '2xl': '24px' },
      boxShadow: {
        card: '0 1px 3px rgba(0,0,0,0.04), 0 4px 20px rgba(0,0,0,0.03)',
        'card-hover': '0 4px 12px rgba(0,0,0,0.06), 0 12px 40px rgba(0,0,0,0.04)',
        button: '0 2px 8px rgba(244,114,182,0.25)',
        'button-hover': '0 4px 16px rgba(244,114,182,0.35)',
      },
    },
  },
}

export const suwappuPreset = {
  theme: {
    extend: {
      colors: {
        ...domainColors,
        suwappu: {
          // Persimmon scale
          'persimmon-50': t.colors.brand.persimmon[50],
          'persimmon-100': t.colors.brand.persimmon[100],
          'persimmon-200': t.colors.brand.persimmon[200],
          'persimmon-300': t.colors.brand.persimmon[300],
          'persimmon-400': t.colors.brand.persimmon[400],
          'persimmon-500': t.colors.brand.persimmon[500],
          'persimmon-600': t.colors.brand.persimmon[600],
          'persimmon-700': t.colors.brand.persimmon[700],
          'persimmon-800': t.colors.brand.persimmon[800],
          'persimmon-900': t.colors.brand.persimmon[900],
          // Legacy sakura alias
          'sakura-50': t.colors.brand.sakura[50],
          'sakura-100': t.colors.brand.sakura[100],
          'sakura-200': t.colors.brand.sakura[200],
          'sakura-300': t.colors.brand.sakura[300],
          'sakura-400': t.colors.brand.sakura[400],
          'sakura-500': t.colors.brand.sakura[500],
          'sakura-600': t.colors.brand.sakura[600],
          'sakura-700': t.colors.brand.sakura[700],
          'sakura-800': t.colors.brand.sakura[800],
          'sakura-900': t.colors.brand.sakura[900],
          // Legacy aliases
          'sakura-light': t.colors.brand.sakuraPinkLight,
          'sakura-mid': t.colors.brand.sakuraPinkMid,
          // Primary palette
          'cream': t.colors.brand.persimmonCream,
          'sunlit-flesh': t.colors.brand.sunlitFlesh,
          'core': t.colors.brand.persimmonCore,
          'golden-calyx': t.colors.brand.goldenCalyx,
          'burnt-stem': t.colors.brand.burntStem,
          'ink-brown': t.colors.brand.inkBrown,
          'magenta': t.colors.brand.magentaCore,
          'rose': t.colors.brand.roseGradientStart,
          'magenta-mid': t.colors.brand.magentaGradientMid,
          'purple': t.colors.brand.deepPurpleGradientEnd,
          'purple-deep': t.colors.brand.royalPurpleDeep,
          // Secondary
          'sky': t.colors.secondary.sky,
          'cyan': t.colors.secondary.cyan,
          'blue': t.colors.secondary.blue,
          'navy': t.colors.secondary.navy,
          'ocean': t.colors.secondary.ocean,
          // Semantic
          'success': t.colors.semantic.success,
          'warning': t.colors.semantic.warning,
          'error': t.colors.semantic.error,
          'info': t.colors.semantic.info,
          // Neutral
          'bg': t.colors.neutral.background,
          'text': t.colors.neutral.textPrimary,
          'text-secondary': t.colors.neutral.textSecondary,
          'text-muted': '#AD987E',
          'magenta-dark': '#864521',
        },
      },
      fontFamily: {
        display: ['Pacifico', 'Dancing Script', 'Satisfy', 'cursive'],
        heading: ['Quicksand', 'Nunito', 'Poppins', 'sans-serif'],
        body: ['Nunito', 'Open Sans', 'Lato', 'sans-serif'],
      },
      borderRadius: sharedBorderRadius,
      boxShadow: sharedBoxShadow,
      backgroundImage: {
        'suwappu-gradient': t.gradients.primaryBrand,
        'suwappu-button-hover': t.gradients.buttonHover,
        'suwappu-card': t.gradients.cardAmbient,
        'suwappu-glass': t.gradients.glassLight,
        'suwappu-petal': t.gradients.petalGradient,
      },
      animation: sharedAnimations,
      keyframes: sharedKeyframes,
    },
  },
} as const

/**
 * Professional (terminal/trading) Tailwind preset.
 *
 * Usage in tailwind.config:
 *   import { professionalPreset } from '@suwappu/design-tokens/tailwind'
 *   export default { presets: [professionalPreset], ... }
 */
export const professionalPreset = {
  theme: {
    extend: {
      colors: {
        ...domainColors,
        terminal: {
          bg: t.colors.surface.professional.background,
          'bg-secondary': t.colors.surface.professional.bgSecondary,
          'bg-tertiary': t.colors.surface.professional.bgTertiary,
          panel: t.colors.surface.professional.panel,
          border: t.colors.surface.professional.border,
          'border-active': t.colors.surface.professional.borderActive,
          text: t.colors.surface.professional.text,
          'text-secondary': t.colors.surface.professional.textSecondary,
          'text-muted': t.colors.surface.professional.textMuted,
        },
        persimmon: t.colors.brand.persimmon,
        sakura: t.colors.brand.sakura,
        bull: t.colors.trading.bull,
        bear: t.colors.trading.bear,
        'bull-dim': t.colors.trading.bullDim,
        'bear-dim': t.colors.trading.bearDim,
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'SF Mono', 'Monaco', 'monospace'],
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
      borderRadius: sharedBorderRadius,
      boxShadow: sharedBoxShadow,
      animation: {
        ...sharedAnimations,
        'pulse-slow': 'pulse 3s ease-in-out infinite',
      },
      keyframes: sharedKeyframes,
    },
  },
} as const
