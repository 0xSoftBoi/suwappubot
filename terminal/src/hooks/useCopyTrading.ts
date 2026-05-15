import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import type { FollowSettings } from '../types/api'

export function useTopTraders(timeframe?: string, limit?: number) {
  return useQuery({
    queryKey: ['top-traders', timeframe, limit],
    queryFn: () => api.getTopTraders(timeframe, limit),
    staleTime: 30_000,
  })
}

export function useTraderProfile(traderId: string | null) {
  return useQuery({
    queryKey: ['trader-profile', traderId],
    queryFn: () => api.getTraderProfile(traderId!),
    enabled: !!traderId,
    staleTime: 30_000,
  })
}

export function useFollowTrader() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ traderId, settings }: { traderId: string; settings: FollowSettings }) =>
      api.followTrader(traderId, settings),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['following'] })
      queryClient.invalidateQueries({ queryKey: ['top-traders'] })
    },
  })
}

export function useUnfollowTrader() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (traderId: string) => api.unfollowTrader(traderId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['following'] })
      queryClient.invalidateQueries({ queryKey: ['top-traders'] })
    },
  })
}

export function useFollowing() {
  return useQuery({
    queryKey: ['following'],
    queryFn: () => api.getFollowing(),
    staleTime: 15_000,
  })
}

export function useCopyTrades(limit?: number) {
  return useQuery({
    queryKey: ['copy-trades', limit],
    queryFn: () => api.getCopyTrades(limit),
    staleTime: 10_000,
  })
}

export function useUpdateFollowSettings() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ traderId, settings }: { traderId: string; settings: FollowSettings }) =>
      api.updateFollowSettings(traderId, settings),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['following'] })
    },
  })
}
