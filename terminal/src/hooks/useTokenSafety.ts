import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'

// Aggregated token-safety report for a (chain, address). Cached generously —
// safety attributes change rarely. Disabled for native/placeholder addresses.
export function useTokenSafety(chain: string | null | undefined, address: string | null | undefined) {
  const enabled = !!chain && !!address && /^(0x[a-fA-F0-9]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})$/.test(address)
  return useQuery({
    queryKey: ['token-safety', chain, address],
    queryFn: () => api.getTokenSafety(chain!, address!),
    enabled,
    staleTime: 5 * 60_000,
    refetchInterval: false,
  })
}
