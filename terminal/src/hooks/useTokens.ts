import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'

export function usePopularTokens(chain?: string) {
  return useQuery({
    queryKey: ['popular-tokens', chain],
    queryFn: () => api.getPopularTokens(chain),
    staleTime: 60_000,
  })
}

export function useSearchTokens(query: string, chain?: string) {
  return useQuery({
    queryKey: ['token-search', query, chain],
    queryFn: () => api.searchTokens(query, chain),
    enabled: query.length >= 1,
    staleTime: 30_000,
  })
}

export function useChains() {
  return useQuery({
    queryKey: ['chains'],
    queryFn: () => api.getChains(),
    staleTime: 300_000,
  })
}
