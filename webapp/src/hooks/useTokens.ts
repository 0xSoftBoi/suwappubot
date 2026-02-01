import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { api } from '../lib/api'
import type { SwapToken } from '../types/swap'

// Supported chains for prefetching
const SUPPORTED_CHAINS = ['1', '137', '42161', '10', '8453']

/**
 * Hook to fetch available tokens for swapping
 * 
 * @param chain - Optional chain filter (defaults to Ethereum)
 * @param includeBalances - Whether to include user balances (requires auth)
 */
export function useTokens(chain = '1', includeBalances = true) {
  const queryClient = useQueryClient()

  // Prefetch other chains in background
  useEffect(() => {
    SUPPORTED_CHAINS.forEach((chainId) => {
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
