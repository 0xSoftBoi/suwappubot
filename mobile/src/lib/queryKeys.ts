/**
 * Centralised query keys.
 *
 * Keys are declared in one place so invalidation is precise. Scattering
 * inline array literals across screens is how you end up calling
 * `invalidateQueries()` with no arguments and refetching the entire app after
 * every swap.
 */
export const queryKeys = {
  portfolio: () => ['portfolio'] as const,
  portfolioPnl: (period: string) => ['portfolio', 'pnl', period] as const,
  wallet: () => ['wallet'] as const,
  swaps: (limit: number, offset: number) => ['swaps', limit, offset] as const,
  swapStatus: (id: string) => ['swap-status', id] as const,
  tokens: (chain: string) => ['tokens', chain] as const,
  chains: () => ['chains'] as const,
  quote: (params: Record<string, string | number>) => ['quote', params] as const,
  health: () => ['health'] as const,
} as const
