import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import { useAuth } from '../contexts/AuthContext'

export function useReferralStats() {
  const { isAuthenticated } = useAuth()

  return useQuery({
    queryKey: ['referrals', 'stats'],
    queryFn: () => api.getReferralStats(),
    enabled: isAuthenticated,
    staleTime: 30_000,
    refetchInterval: 60_000,
  })
}

export function useReferralsList() {
  const { isAuthenticated } = useAuth()

  return useQuery({
    queryKey: ['referrals', 'list'],
    queryFn: () => api.getReferralsList(),
    enabled: isAuthenticated,
    staleTime: 60_000,
  })
}

export function useReferralLeaderboard() {
  const { isAuthenticated } = useAuth()

  return useQuery({
    queryKey: ['referrals', 'leaderboard'],
    queryFn: () => api.getReferralLeaderboard(),
    enabled: isAuthenticated,
    staleTime: 60_000,
    refetchInterval: 120_000,
  })
}
