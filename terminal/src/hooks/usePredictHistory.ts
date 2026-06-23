import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'

// Probability history for a single Polymarket outcome (CLOB token id), via the
// public prices-history feed. `range` is a time window (1H/6H/1D/1W/1M/ALL).
export function usePredictHistory(tokenId: string | null, range: string = '1W') {
  return useQuery({
    queryKey: ['predict-history', tokenId, range],
    queryFn: () => api.getPredictHistory(tokenId!, range),
    enabled: !!tokenId,
    staleTime: 30_000,
    refetchInterval: 60_000,
  })
}
