import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import { useAuth } from '../contexts/AuthContext'

export function usePoints() {
  const { isAuthenticated } = useAuth()

  return useQuery({
    queryKey: ['points', 'profile'],
    queryFn: () => api.getPoints(),
    enabled: isAuthenticated,
    staleTime: 30_000,
    refetchInterval: 60_000,
  })
}

export function useCheckin() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => api.checkin(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['points'] })
    },
  })
}

export function useMilestones() {
  const { isAuthenticated } = useAuth()

  return useQuery({
    queryKey: ['points', 'milestones'],
    queryFn: () => api.getMilestones(),
    enabled: isAuthenticated,
    staleTime: 60_000,
  })
}

export function useRewardStore() {
  const { isAuthenticated } = useAuth()

  return useQuery({
    queryKey: ['points', 'rewards'],
    queryFn: () => api.getRewardStore(),
    enabled: isAuthenticated,
    staleTime: 60_000,
  })
}

export function useRedeemReward() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (rewardId: string) => api.redeemReward(rewardId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['points'] })
    },
  })
}

export function usePointsLeaderboard(timeframe?: string, limit?: number) {
  return useQuery({
    queryKey: ['points', 'leaderboard', timeframe, limit],
    queryFn: () => api.getPointsLeaderboard(timeframe, limit),
    staleTime: 30_000,
    refetchInterval: 120_000,
  })
}
