/**
 * React Query hooks for token watchlist management.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'

export function useWatchlist() {
  return useQuery({
    queryKey: ['watchlist'],
    queryFn: () => api.getWatchlist(),
  })
}

export function useAddToWatchlist() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (tokenAddress: string) => api.addToWatchlist(tokenAddress),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['watchlist'] }),
  })
}

export function useRemoveFromWatchlist() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.removeFromWatchlist(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['watchlist'] }),
  })
}
