/**
 * Centralized React Query key factories.
 *
 * Using a factory pattern ensures consistency across hooks and
 * makes cache invalidation predictable.
 *
 * Usage:
 *   queryKey: queryKeys.portfolio.all
 *   queryKey: queryKeys.swaps.list(20, 0)
 *   queryKey: queryKeys.tokens.byChain('1')
 */

export const queryKeys = {
  portfolio: {
    all: ['portfolio'] as const,
  },
  swaps: {
    all: ['swaps'] as const,
    list: (limit: number, offset: number) => ['swaps', { limit, offset }] as const,
    status: (swapId: number | null) => ['swap-status', swapId] as const,
  },
  tokens: {
    all: ['tokens'] as const,
    byChain: (chainId: string) => ['tokens', chainId] as const,
  },
  wallets: {
    all: ['wallets'] as const,
    linked: ['wallets', 'linked'] as const,
  },
  points: {
    stats: ['points', 'stats'] as const,
    history: (limit: number, offset: number) => ['points', 'history', { limit, offset }] as const,
    leaderboard: (limit: number) => ['points', 'leaderboard', { limit }] as const,
    rewards: ['points', 'rewards'] as const,
  },
  limitOrders: {
    all: ['limit-orders'] as const,
    list: (status?: string) => ['limit-orders', { status }] as const,
  },
  preferences: {
    all: ['preferences'] as const,
  },
  health: {
    all: ['health'] as const,
  },
} as const
