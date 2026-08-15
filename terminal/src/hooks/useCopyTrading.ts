import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import { useAuth } from '../contexts/AuthContext'
import type { FollowSettings } from '../types/api'

export function useTopTraders(timeframe?: string, limit?: number, query?: string) {
  return useQuery({
    queryKey: ['top-traders', timeframe, limit, query],
    queryFn: () => api.getTopTraders(timeframe, limit, query),
    staleTime: 30_000,
  })
}

export function useTraderFeed(limit = 50) {
  return useQuery({
    queryKey: ['trader-feed', limit],
    queryFn: () => api.getTraderFeed(limit),
    staleTime: 10_000,
    refetchInterval: 15_000,
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
      queryClient.invalidateQueries({ queryKey: ['trader-profile'] })
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
      queryClient.invalidateQueries({ queryKey: ['trader-profile'] })
    },
  })
}

export function useFollowing() {
  const { isAuthenticated } = useAuth()
  return useQuery({
    queryKey: ['following'],
    queryFn: () => api.getFollowing(),
    enabled: isAuthenticated,
    staleTime: 15_000,
  })
}

export function useCopyTrades(limit?: number) {
  const { isAuthenticated } = useAuth()
  return useQuery({
    queryKey: ['copy-trades', limit],
    queryFn: () => api.getCopyTrades(limit),
    enabled: isAuthenticated,
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
      queryClient.invalidateQueries({ queryKey: ['trader-profile'] })
    },
  })
}
