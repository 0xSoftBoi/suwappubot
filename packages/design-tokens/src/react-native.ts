/**
 * @suwappu/design-tokens — React Native Tokens
 *
 * Platform-compatible tokens for React Native / Expo.
 * No CSS vars, no rgba for simple colors, no gradients/animations/glassmorphism.
 */

import { designTokens } from './tokens'

const t = designTokens

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface RNShadow {
  shadowColor: string
  shadowOffset: { width: number; height: number }
  shadowOpacity: number
  shadowRadius: number
  elevation: number
}

function rnShadow(
  color: string,
  offsetY: number,
  opacity: number,
  radius: number,
  elevation: number,
): RNShadow {
  return {
    shadowColor: color,
    shadowOffset: { width: 0, height: offsetY },
    shadowOpacity: opacity,
    shadowRadius: radius,
    elevation,
  } as const
}

// ---------------------------------------------------------------------------
// Shared (platform-agnostic) tokens
// ---------------------------------------------------------------------------

const sharedColors = {
  brand: {
    persimmonCream: t.colors.brand.persimmonCream,
    sunlitFlesh: t.colors.brand.sunlitFlesh,
    persimmonCore: t.colors.brand.persimmonCore,
    goldenCalyx: t.colors.brand.goldenCalyx,
    burntStem: t.colors.brand.burntStem,
    inkBrown: t.colors.brand.inkBrown,
    sakuraPinkLight: t.colors.brand.sakuraPinkLight,
    sakuraPinkMid: t.colors.brand.sakuraPinkMid,
    magentaCore: t.colors.brand.magentaCore,
    roseGradientStart: t.colors.brand.roseGradientStart,
    magentaGradientMid: t.colors.brand.magentaGradientMid,
    deepPurpleGradientEnd: t.colors.brand.deepPurpleGradientEnd,
    royalPurpleDeep: t.colors.brand.royalPurpleDeep,
    persimmon: t.colors.brand.persimmon,
    sakura: t.colors.brand.sakura,
  },
  secondary: t.colors.secondary,
  semantic: t.colors.semantic,
  impact: t.colors.impact,
  txState: t.colors.txState,
  chain: t.colors.chain,
  provider: t.colors.provider,
  trading: t.colors.trading,
} as const

const spacing = {
  baseUnit: t.spacing.baseUnit,
  xxs: t.spacing.scale.xxs,
  xs: t.spacing.scale.xs,
  sm: t.spacing.scale.sm,
  md: t.spacing.scale.md,
  lg: t.spacing.scale.lg,
  xl: t.spacing.scale.xl,
  xxl: t.spacing.scale.xxl,
  xxxl: t.spacing.scale.xxxl,
} as const

const borderRadius = {
  none: t.borderRadius.none,
  sm: t.borderRadius.sm,
  md: t.borderRadius.md,
  lg: t.borderRadius.lg,
  xl: t.borderRadius.xl,
  xxl: t.borderRadius.xxl,
  xxxl: t.borderRadius.xxxl,
  full: t.borderRadius.full,
  pill: t.borderRadius.pill,
} as const

const fontWeights = {
  regular: '400' as const,
  medium: '500' as const,
  semibold: '600' as const,
  bold: '700' as const,
}

const shadows = {
  level1: rnShadow('#5B3A24', 1, 0.05, 3, 1),
  level2: rnShadow('#B07E40', 4, 0.08, 8, 3),
  level3: rnShadow('#B07E40', 10, 0.12, 24, 6),
  level4: rnShadow('#B07E40', 15, 0.16, 32, 10),
  glow: rnShadow('#F4C963', 0, 0.35, 20, 8),
  button: rnShadow('#E58D2B', 4, 0.28, 15, 5),
  buttonHover: rnShadow('#E58D2B', 8, 0.34, 25, 8),
} as const

const tokenIcon = t.tokenIcon
const chainBadge = t.chainBadge
const breakpoints = t.breakpoints

// ---------------------------------------------------------------------------
// Sakura (consumer) theme
// ---------------------------------------------------------------------------

export const sakuraTheme = {
  colors: {
    ...sharedColors,
    neutral: {
      white: t.colors.neutral.white,
      background: t.colors.neutral.background,
      textPrimary: t.colors.neutral.textPrimary,
      textSecondary: t.colors.neutral.textSecondary,
      border: '#E6D9C3',
    },
    surface: {
      background: t.colors.surface.sakura.background,
      surface: t.colors.surface.sakura.surface,
      surfaceElevated: t.colors.surface.sakura.surfaceElevated,
      textPrimary: t.colors.surface.sakura.textPrimary,
      textSecondary: t.colors.surface.sakura.textSecondary,
      border: '#E6D9C3',
    },
  },
  typography: {
    fontFamilies: {
      display: 'Pacifico',
      heading: 'Quicksand',
      body: 'Nunito',
      ui: 'Nunito',
    },
    fontWeights,
    scale: t.typography.scale,
  },
  spacing,
  borderRadius,
  shadows,
  tokenIcon,
  chainBadge,
  breakpoints,
} as const

// ---------------------------------------------------------------------------
// Professional (terminal/trading) theme
// ---------------------------------------------------------------------------

export const professionalTheme = {
  colors: {
    ...sharedColors,
    neutral: {
      white: t.colors.neutral.white,
      background: t.colors.surface.professional.background,
      textPrimary: t.colors.surface.professional.text,
      textSecondary: t.colors.surface.professional.textSecondary,
      border: t.colors.surface.professional.border,
    },
    surface: {
      background: t.colors.surface.professional.background,
      bgSecondary: t.colors.surface.professional.bgSecondary,
      bgTertiary: t.colors.surface.professional.bgTertiary,
      panel: t.colors.surface.professional.panel,
      border: t.colors.surface.professional.border,
      borderActive: t.colors.surface.professional.borderActive,
      text: t.colors.surface.professional.text,
      textSecondary: t.colors.surface.professional.textSecondary,
      textMuted: t.colors.surface.professional.textMuted,
    },
  },
  typography: {
    fontFamilies: {
      display: 'JetBrains Mono',
      heading: 'Inter',
      body: 'Inter',
      ui: 'Inter',
      mono: 'JetBrains Mono',
    },
    fontWeights,
    scale: t.typography.scale,
  },
  spacing,
  borderRadius,
  shadows,
  tokenIcon,
  chainBadge,
  breakpoints,
} as const
