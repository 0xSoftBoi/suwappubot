import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import { useAuth } from '../contexts/AuthContext'

export function useRewardsSummary() {
  const { isAuthenticated } = useAuth()

  return useQuery({
    queryKey: ['rewards', 'summary'],
    queryFn: () => api.getRewardsSummary(),
    enabled: isAuthenticated,
    staleTime: 30_000,
    refetchInterval: 60_000,
  })
}

export function useRewardsClaimPayload(epochIndex: number | null) {
  const { isAuthenticated } = useAuth()

  return useQuery({
    queryKey: ['rewards', 'claim', epochIndex],
    queryFn: () => api.getRewardsClaimPayload(epochIndex as number),
    enabled: isAuthenticated && epochIndex !== null,
    staleTime: 60_000,
    retry: false, // 404 = no leaf for this epoch; don't hammer
  })
}
