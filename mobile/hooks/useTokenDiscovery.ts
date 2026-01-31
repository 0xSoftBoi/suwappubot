/**
 * React Query hooks for token discovery — trending, gainers, new listings, search.
 */
import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'

export interface DiscoveryToken {
  address: string
  symbol: string
  name: string
  chain: string
  price: number
  change24h: number
  volume24h: number
  marketCap: number | null
  logoUrl: string | null
}

export function useTrendingTokens(chain = 'all', limit = 50) {
  return useQuery<DiscoveryToken[]>({
    queryKey: ['discover', 'trending', chain, limit],
    queryFn: () => api.getDiscoverTrending(chain, limit),
    staleTime: 60_000,
    refetchInterval: 120_000,
  })
}

export function useGainerTokens(timeframe = '24h') {
  return useQuery<DiscoveryToken[]>({
    queryKey: ['discover', 'gainers', timeframe],
    queryFn: () => api.getDiscoverGainers(timeframe),
    staleTime: 60_000,
    refetchInterval: 120_000,
  })
}

export function useNewTokens(chain = 'all') {
  return useQuery<DiscoveryToken[]>({
    queryKey: ['discover', 'new', chain],
    queryFn: () => api.getDiscoverNew(chain),
    staleTime: 60_000,
    refetchInterval: 120_000,
  })
}

export function useTokenSearch(query: string) {
  return useQuery<DiscoveryToken[]>({
    queryKey: ['discover', 'search', query],
    queryFn: () => api.getDiscoverSearch(query),
    enabled: query.length >= 2,
    staleTime: 30_000,
  })
}
