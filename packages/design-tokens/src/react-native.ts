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
    sakuraPinkLight: '#FFD1DC',
    sakuraPinkMid: '#FFB7C5',
    magentaCore: '#E91E8C',
    roseGradientStart: '#F8A5C2',
    magentaGradientMid: '#C44569',
    deepPurpleGradientEnd: '#6C3483',
    royalPurpleDeep: '#4A235A',
    sakura: t.colors.brand.sakura,
  },
  secondary: {
    sky: '#E8F4FD',
    cyan: '#B3E5FC',
    blue: '#87CEEB',
    navy: '#1A237E',
    ocean: '#0D1B4C',
  },
  semantic: {
    success: '#A8E6A3',
    warning: '#FFE4A0',
    error: '#F8A0A0',
    info: '#90CAF9',
  },
  impact: {
    negligible: '#4ADE80',
    low: '#22C55E',
    medium: '#FACC15',
    high: '#F97316',
    severe: '#EF4444',
  },
  txState: {
    pending: '#F59E0B',
    confirming: '#3B82F6',
    bridging: '#8B5CF6',
    success: '#22C55E',
    failed: '#EF4444',
    expired: '#6B7280',
  },
  chain: {
    ethereum: '#627EEA',
    bsc: '#F0B90B',
    polygon: '#8247E5',
    arbitrum: '#28A0F0',
    optimism: '#FF0420',
    base: '#0052FF',
    avalanche: '#E84142',
    fantom: '#1969FF',
    linea: '#121212',
    mantle: '#000000',
    gnosis: '#04795B',
    scroll: '#FFEEDA',
    solana: '#9945FF',
    sui: '#6FBCF0',
    ton: '#0098EA',
  },
  provider: {
    cow: '#EC4612',
    jupiter: '#C7F284',
    socket: '#7B3FE4',
    cctp: '#3B6EAE',
    across: '#6CF9D8',
    wormhole: '#A45EFF',
    lifi: '#EF49A0',
    layerzero: '#1E1E1E',
    ccip: '#375BD2',
  },
  trading: {
    bull: '#22C55E',
    bear: '#EF4444',
    bullDim: '#16351F',
    bearDim: '#351616',
  },
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
  level1: rnShadow('#6A1B9A', 1, 0.06, 3, 1),
  level2: rnShadow('#6A1B9A', 4, 0.08, 6, 3),
  level3: rnShadow('#6A1B9A', 10, 0.12, 25, 6),
  level4: rnShadow('#6A1B9A', 15, 0.15, 35, 10),
  glow: rnShadow('#FFB7C5', 0, 0.4, 20, 8),
  button: rnShadow('#C44569', 4, 0.35, 15, 5),
  buttonHover: rnShadow('#C44569', 8, 0.45, 25, 8),
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
      white: '#FFFFFF',
      background: '#FFFBFC',
      textPrimary: '#2C3E50',
      textSecondary: '#6C7A89',
      border: '#FFB7C540',
    },
    surface: {
      background: '#1A1625',
      surface: '#2D2640',
      surfaceElevated: '#3D3455',
      textPrimary: '#F8F4FB',
      textSecondary: '#B8A5C8',
      border: '#FFB7C526',
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
      white: '#FFFFFF',
      background: '#0A0A0F',
      textPrimary: '#E2E2F0',
      textSecondary: '#8888A0',
      border: '#1E1E30',
    },
    surface: {
      background: '#0A0A0F',
      bgSecondary: '#12121A',
      bgTertiary: '#1A1A2E',
      panel: '#0F0F18',
      border: '#1E1E30',
      borderActive: '#2A2A45',
      text: '#E2E2F0',
      textSecondary: '#8888A0',
      textMuted: '#55556A',
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
