/**
 * React Query hooks for copy trading.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api, type FollowTraderRequest } from '../lib/api'

export function useTraderLeaderboard(limit = 50) {
  return useQuery({
    queryKey: ['traderLeaderboard', limit],
    queryFn: () => api.getTraders('rank_score', limit),
  })
}

export function useTraderProfile(traderId: number) {
  return useQuery({
    queryKey: ['trader', traderId],
    queryFn: () => api.getTrader(traderId),
    enabled: !!traderId,
  })
}

export function useFollowTrader() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ traderId, config }: { traderId: number; config: FollowTraderRequest }) =>
      api.followTrader(traderId, config),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['myFollows'] })
      qc.invalidateQueries({ queryKey: ['traderLeaderboard'] })
    },
  })
}

export function useUnfollowTrader() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (traderId: number) => api.unfollowTrader(traderId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['myFollows'] })
      qc.invalidateQueries({ queryKey: ['traderLeaderboard'] })
    },
  })
}

export function useMyFollows() {
  return useQuery({
    queryKey: ['myFollows'],
    queryFn: () => api.getFollowing(),
  })
}

export function useCopyTrades() {
  return useQuery({
    queryKey: ['copyTrades'],
    queryFn: () => api.getCopyTrades(),
  })
}
