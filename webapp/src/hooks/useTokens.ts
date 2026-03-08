import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import type { SwapToken } from '../types/swap'

/**
 * Hook to fetch available tokens for swapping
 * 
 * @param chain - Optional chain filter
 * @param includeBalances - Whether to include user balances (requires auth)
 */
export function useTokens(chain = '1', includeBalances = true) {
  const queryClient = useQueryClient()

  // Prefetch other common chains in background
  const PREFETCH_CHAINS = ['1', '137', '42161', '8453', '10']
  useEffect(() => {
    PREFETCH_CHAINS.forEach((chainId) => {
      if (chainId !== chain) {
        queryClient.prefetchQuery({
          queryKey: ['tokens', chainId, includeBalances],
          queryFn: () => api.getTokens(chainId, includeBalances),
          staleTime: 2 * 60 * 1000, // 2 minutes for prefetched data
        })
      }
    })
  }, [chain, includeBalances, queryClient])

  return useQuery({
    queryKey: ['tokens', chain, includeBalances],
    queryFn: () => api.getTokens(chain, includeBalances),
    staleTime: 30 * 1000, // 30 seconds - refresh often for prices
    gcTime: 5 * 60 * 1000, // Keep in cache 5 minutes
    refetchOnWindowFocus: true,
    refetchInterval: 60 * 1000, // Auto-refresh every minute
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
