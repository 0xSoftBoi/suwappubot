import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'

export function useLendingMarkets() {
  return useQuery({
    queryKey: ['lending-markets'],
    queryFn: () => api.getLendingMarkets(),
    staleTime: 60_000,
  })
}

export function useLendingMarket(id: string) {
  return useQuery({
    queryKey: ['lending-market', id],
    queryFn: () => api.getLendingMarket(id),
    enabled: !!id,
    staleTime: 60_000,
  })
}
