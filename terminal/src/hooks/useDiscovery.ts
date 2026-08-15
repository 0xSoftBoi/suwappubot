import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'

export function useNewPools(chain: string, limit: number = 20) {
  return useQuery({
    queryKey: ['discovery-new-pools', chain, limit],
    queryFn: () => api.getNewPools(chain, limit),
    staleTime: 15_000,
    refetchInterval: 30_000,
  })
}

export function useTrendingPools(chain: string, limit: number = 20) {
  return useQuery({
    queryKey: ['discovery-trending-pools', chain, limit],
    queryFn: () => api.getTrendingPools(chain, limit),
    staleTime: 30_000,
    refetchInterval: 30_000,
  })
}

export function useTokenSecurity(chain: string, address: string | null) {
  return useQuery({
    queryKey: ['token-security', chain, address],
    queryFn: () => api.getTokenSecurity(chain, address!),
    enabled: !!address,
    staleTime: 5 * 60_000,
  })
}
