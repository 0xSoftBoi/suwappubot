/**
 * Centralized color tokens for the Suwappu dark theme.
 */
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

  // Status badge colors
  statusActive: '#22c55e',
  statusPending: '#f59e0b',
  statusTriggered: '#3b82f6',
  statusCancelled: '#666',
  statusFailed: '#ef4444',
  statusPaused: '#f59e0b',
  statusCompleted: '#22c55e',
  statusExecuted: '#22c55e',

  // Chain badge colors
  chainEvm: '#627eea',
  chainSolana: '#9945ff',
} as const

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
} as const

export const radius = {
  sm: 8,
  md: 14,
  lg: 20,
  xl: 24,
  xxl: 32,
  full: 999,
} as const
