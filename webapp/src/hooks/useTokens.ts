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
 */
export function useTokenSearch(query: string, chain?: string) {
  const { data: tokens, ...rest } = useTokens(chain)
  
  const filteredTokens = tokens?.filter((token: SwapToken) => {
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
