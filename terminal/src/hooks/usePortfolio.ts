import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import { useAuth } from '../contexts/AuthContext'

export function usePortfolio() {
  const { isAuthenticated } = useAuth()

  return useQuery({
    queryKey: ['portfolio'],
    queryFn: () => api.getPortfolio(),
    enabled: isAuthenticated,
    staleTime: 30_000,
    refetchInterval: 60_000,
  })
}
