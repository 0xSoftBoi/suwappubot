import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import { useAuth } from '../contexts/AuthContext'

// Swap history for the current session. Keyed 'swap-history' so the swap hooks
// (useSwapExecute / useExternalSwap / useSolanaSwap) that already invalidate that
// key refresh it after a swap. The tx_poller reconciles pending -> completed/
// failed in the background, so a periodic refetch surfaces the final status.
export function useSwaps() {
  const { isAuthenticated } = useAuth()
  return useQuery({
    queryKey: ['swap-history'],
    queryFn: () => api.getSwaps(),
    enabled: isAuthenticated,
    // Pending client-broadcast swaps settle within ~a minute; refetch so the
    // status flips without a manual reload.
    refetchInterval: (query) => {
      const data = query.state.data
      const hasPending = Array.isArray(data)
        ? data.some((s) => s.status === 'pending' || s.status === 'submitted')
        : false
      return hasPending ? 8000 : false
    },
  })
}
