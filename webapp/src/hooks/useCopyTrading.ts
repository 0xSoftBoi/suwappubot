import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import type { CopyFollowSettings } from '../lib/api'

export function useTopTraders(filters?: {
  minTrades?: number
  minWinRate?: number
  chain?: string
  sortBy?: string
}) {
  return useQuery({
    queryKey: ['copyTrading', 'topTraders', filters],
    queryFn: () => api.getTopTraders(filters),
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
  })
}

export function useTraderProfile(id: number | null) {
  return useQuery({
    queryKey: ['copyTrading', 'traderProfile', id],
    queryFn: () => api.getTraderProfile(id!),
    enabled: id !== null,
    staleTime: 30 * 1000,
  })
}

export function useFollowing() {
  return useQuery({
    queryKey: ['copyTrading', 'following'],
    queryFn: () => api.getFollowing(),
    staleTime: 30 * 1000,
  })
}

export function useCopyTrades(limit = 20, offset = 0) {
  return useQuery({
    queryKey: ['copyTrading', 'trades', limit, offset],
    queryFn: () => api.getCopyTrades(limit, offset),
    staleTime: 30 * 1000,
  })
}

export function useFollow() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ traderId, settings }: { traderId: number; settings: CopyFollowSettings }) =>
      api.followTrader(traderId, settings),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['copyTrading', 'following'] })
      queryClient.invalidateQueries({ queryKey: ['copyTrading', 'topTraders'] })
    },
  })
}

export function useUnfollow() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (traderId: number) => api.unfollowTrader(traderId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['copyTrading', 'following'] })
      queryClient.invalidateQueries({ queryKey: ['copyTrading', 'topTraders'] })
    },
  })
}

export function useUpdateCopySettings() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ traderId, settings }: { traderId: number; settings: CopyFollowSettings }) =>
      api.updateCopySettings(traderId, settings),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['copyTrading', 'following'] })
    },
  })
}
