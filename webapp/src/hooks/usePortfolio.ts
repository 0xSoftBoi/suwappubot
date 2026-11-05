import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'

export function usePortfolio() {
  return useQuery({
    queryKey: ['portfolio'],
    queryFn: () => api.getPortfolio(),
    staleTime: 10 * 1000, // 10 seconds — balances move
    // Casino-grade: keep balances fresh while the app is open. Pauses in
    // background tabs (refetchIntervalInBackground: false).
    refetchInterval: 15 * 1000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    // Keep the last balances visible during refetch — no flash to empty.
    placeholderData: (prev) => prev,
  })
}
