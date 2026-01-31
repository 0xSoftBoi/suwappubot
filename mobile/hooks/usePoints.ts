/**
 * React Query hooks for points/XP system.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'

export function usePoints() {
  return useQuery({
    queryKey: ['points'],
    queryFn: () => api.getPoints(),
  })
}

export function useDailyCheckin() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.dailyCheckin(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['points'] }),
  })
}

export function useMilestones() {
  return useQuery({
    queryKey: ['milestones'],
    queryFn: () => api.getMilestones(),
  })
}

export function useRewards() {
  return useQuery({
    queryKey: ['rewards'],
    queryFn: () => api.getRewards(),
  })
}

export function useRedeemReward() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (rewardId: number) => api.redeemReward(rewardId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['points'] })
      qc.invalidateQueries({ queryKey: ['rewards'] })
    },
  })
}

export function useLeaderboard(limit = 50) {
  return useQuery({
    queryKey: ['leaderboard', limit],
    queryFn: () => api.getLeaderboard(limit),
  })
}

export function usePointsHistory(limit = 50, offset = 0) {
  return useQuery({
    queryKey: ['pointsHistory', limit, offset],
    queryFn: () => api.getPointsHistory(limit, offset),
  })
}
