import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'

const DEVWATCH_LIST_KEY = ['token-intel', 'devwatch', 'list'] as const
const DEVWATCH_HITS_KEY = ['token-intel', 'devwatch', 'hits'] as const

// Single-token intel lookup. Disabled until both chain + address are present
// so the panel doesn't fire on an empty input. Not too aggressive on refetch —
// deployer/holder data doesn't change second to second.
export function useTokenIntel(chain: string, tokenAddress: string) {
  return useQuery({
    queryKey: ['token-intel', chain, tokenAddress],
    queryFn: () => api.getTokenIntel(chain, tokenAddress),
    enabled: Boolean(chain && tokenAddress),
    staleTime: 30_000,
    retry: 1,
  })
}

export function useDevWatchList() {
  return useQuery({
    queryKey: DEVWATCH_LIST_KEY,
    queryFn: () => api.getDevWatchList(),
    staleTime: 15_000,
  })
}

export function useDevWatchHits(limit = 50) {
  return useQuery({
    queryKey: [...DEVWATCH_HITS_KEY, limit],
    queryFn: () => api.getDevWatchHits(limit),
    staleTime: 15_000,
    refetchInterval: 60_000,
  })
}

export function useAddDevWatch() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (params: { deployer_address: string; chain: string; label?: string }) =>
      api.addDevWatch(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: DEVWATCH_LIST_KEY })
    },
  })
}

export function useRemoveDevWatch() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (watchId: number) => api.removeDevWatch(watchId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: DEVWATCH_LIST_KEY })
    },
  })
}
