import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import type { SwapToken } from '../types/swap'

/**
 * Hook to fetch available tokens for swapping
 * 
 * @param chain - Optional chain filter
 * @param includeBalances - Whether to include user balances (requires auth)
 */
export function useTokens(chain?: string, includeBalances = true) {
  return useQuery({
    queryKey: ['tokens', chain, includeBalances],
    queryFn: () => api.getTokens(chain),
    staleTime: 60 * 1000, // 1 minute
    refetchOnWindowFocus: false,
  })
}

/**
 * Hook to search tokens by symbol or name
 * Uses server-side search for queries >= 2 chars, falls back to client-side filtering
 */
export function useTokenSearch(query: string, chain?: string) {
  const { data: tokens, ...rest } = useTokens(chain)

  // Server-side search for longer queries
  const { data: serverResults } = useQuery({
    queryKey: ['tokenSearch', query, chain],
    queryFn: () => api.searchTokens(query, chain ? [chain] : undefined),
    enabled: query.length >= 2,
    staleTime: 5 * 60 * 1000, // 5 minutes (matches server cache)
    refetchOnWindowFocus: false,
  })

  // Use server results if available, otherwise client-side filter
  const filteredTokens = query.length >= 2 && serverResults
    ? serverResults
    : tokens?.filter((token: SwapToken) => {
        if (!query) return true
        const q = query.toLowerCase()
        return (
          token.symbol.toLowerCase().includes(q) ||
          token.name.toLowerCase().includes(q) ||
          token.address.toLowerCase().includes(q)
        )
      })

  return {
    ...rest,
    data: filteredTokens,
    allTokens: tokens,
  }
}
