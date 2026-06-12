import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'

export function usePortfolio() {
  return useQuery({
    queryKey: ['portfolio'],
    queryFn: () => api.getPortfolio(),
    staleTime: 30 * 1000, // 30 seconds
    refetchOnWindowFocus: true,
  })
}
