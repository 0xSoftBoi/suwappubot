import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import type { SnipeRequest, SnipeResult } from '../types/snipe'

/**
 * Hook for sniping a newly launched token.
 *
 * Returns a mutation that:
 * - Submits the snipe transaction via the API
 * - Invalidates portfolio/swap queries on success
 * - Optionally fires a native desktop notification
 */
export function useSnipe() {
  const queryClient = useQueryClient()

  const mutation = useMutation({
    mutationFn: (request: SnipeRequest): Promise<SnipeResult> => {
      return api.snipeToken(request)
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['portfolio'] })
      queryClient.invalidateQueries({ queryKey: ['swaps'] })
      queryClient.invalidateQueries({ queryKey: ['tokens'] })

      // Send native notification if available
      const desktop = (window as any).__SUWAPPU_DESKTOP__
      if (desktop?.notify) {
        const title = data.status === 'completed' ? 'Snipe Successful' : 'Snipe Submitted'
        const body = data.tokenSymbol
          ? `${data.status === 'completed' ? 'Bought' : 'Buying'} ${data.tokenAmount ?? ''} ${data.tokenSymbol} for ${data.spentAmount} ${data.spentSymbol}`
          : `Snipe ${data.status} — spent ${data.spentAmount} ${data.spentSymbol}`
        desktop.notify(title, body)
      }
    },
    onError: (error: any) => {
      const desktop = (window as any).__SUWAPPU_DESKTOP__
      if (desktop?.notify) {
        desktop.notify('Snipe Failed', error?.detail || error?.message || 'Transaction failed')
      }
    },
  })

  return {
    snipe: mutation.mutate,
    snipeAsync: mutation.mutateAsync,
    isLoading: mutation.isPending,
    error: mutation.error,
    data: mutation.data,
    reset: mutation.reset,
  }
}
