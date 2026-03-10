/**
 * Mobile theme — maps shared design tokens to existing mobile color keys.
 *
 * The mobile app uses a flat color structure (bg, card, text, primary, etc.)
 * while the shared tokens use a nested structure (brand, semantic, surface, etc.).
 * This mapping layer preserves backward compatibility for all existing consumers.
 */
import { sakuraTheme, professionalTheme } from '@suwappu/design-tokens/react-native'

// Re-export full themes for new consumers
export { sakuraTheme, professionalTheme } from '@suwappu/design-tokens/react-native'

// Map shared tokens to mobile's existing flat color structure
export const colors = {
  bg: '#000',
  card: '#111',
  cardAlt: '#1a1a1a',
  border: '#222',
  borderLight: '#333',

  text: '#fff',
  textSecondary: '#888',
  textTertiary: '#666',
  textMuted: '#555',

  primary: '#FF85A1',
  primaryDark: '#E8729A',
  primaryDim: 'rgba(255,133,161,0.12)',
  primaryBorder: 'rgba(255,133,161,0.25)',
  accent: '#FF85A1',
  accentDim: '#E8729A',

  success: '#22c55e',
  successDim: '#15803d',
  warning: '#f59e0b',
  warningDim: '#b45309',
  error: '#ef4444',
  errorDim: '#b91c1c',
  info: '#3b82f6',

  // Status badge colors (mapped from shared tx/semantic tokens)
  statusActive: sakuraTheme.colors.txState.success,
  statusPending: sakuraTheme.colors.txState.pending,
  statusTriggered: sakuraTheme.colors.txState.confirming,
  statusCancelled: '#666',
  statusFailed: sakuraTheme.colors.txState.failed,
  statusPaused: sakuraTheme.colors.txState.pending,
  statusCompleted: sakuraTheme.colors.txState.success,
  statusExecuted: sakuraTheme.colors.txState.success,

  // Chain badge colors
  chainEvm: sakuraTheme.colors.chain.ethereum,
  chainSolana: sakuraTheme.colors.chain.solana,
} as const

// Preserve original mobile spacing (differs from shared tokens scale)
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
} as const

// Preserve original mobile radius (differs from shared tokens scale)
export const radius = {
  sm: 8,
  md: 14,
  lg: 20,
  xl: 24,
  xxl: 32,
  full: 999,
} as const
