import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'

export function useTokenInfo(chain: string, address: string) {
  return useQuery({
    queryKey: ['token-info', chain, address],
    queryFn: () => api.getTokenInfo(chain, address),
    staleTime: 30 * 1000,
    enabled: !!chain && !!address,
  })
}

export function useTokenChart(chain: string, address: string, timeframe: string) {
  return useQuery({
    queryKey: ['token-chart', chain, address, timeframe],
    queryFn: () => api.getTokenChart(chain, address, timeframe),
    staleTime: 15 * 1000,
    refetchInterval: 15 * 1000,
    enabled: !!chain && !!address,
  })
}

export function useTrendingTokens(chain?: string) {
  return useQuery({
    queryKey: ['trending-tokens', chain],
    queryFn: () => api.getTrendingTokens(chain),
    staleTime: 60 * 1000,
    refetchInterval: 60 * 1000,
  })
}
