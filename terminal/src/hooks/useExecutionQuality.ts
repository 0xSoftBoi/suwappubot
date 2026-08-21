import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import { useAuth } from '../contexts/AuthContext'

// Per-user execution quality — markouts on your own perp fills (the
// adverse-selection self-test), swap implementation shortfall vs quote, and
// fee drag. The terminal's flagship depth feature: no retail terminal ships
// this, institutional desks run on it. Gentle refresh — this is a review
// surface, not a live tape.
export function useExecutionQuality() {
  const { isAuthenticated } = useAuth()
  return useQuery({
    queryKey: ['execution-quality'],
    queryFn: () => api.getExecutionQuality(),
    enabled: isAuthenticated,
    staleTime: 60_000,
    refetchInterval: 120_000,
  })
}
