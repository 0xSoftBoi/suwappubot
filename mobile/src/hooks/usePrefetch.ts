/**
 * Prefetching.
 *
 * The cheapest performance win available: fetch the next screen's data while
 * the user is still looking at this one. By the time the navigation animation
 * finishes (~300ms), the data is already in cache and the destination screen
 * renders with content on its first frame.
 *
 * All prefetches run after interactions so they cannot compete with the
 * navigation animation for the JS thread.
 */
import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { endpoints } from '../lib/endpoints'
import { queryKeys } from '../lib/queryKeys'
import { STALE } from '../lib/queryClient'
import { afterInteractions } from '../lib/perf'

export function usePrefetch() {
  const qc = useQueryClient()

  const prefetchPortfolio = useCallback(() => {
    afterInteractions(() => {
      void qc.prefetchQuery({
        queryKey: queryKeys.portfolio(),
        queryFn: ({ signal }) => endpoints.portfolio(signal),
        staleTime: STALE.balance,
      })
    })
  }, [qc])

  const prefetchSwaps = useCallback(() => {
    afterInteractions(() => {
      void qc.prefetchQuery({
        queryKey: queryKeys.swaps(20, 0),
        queryFn: ({ signal }) => endpoints.swaps(20, 0, signal),
        staleTime: STALE.activity,
      })
    })
  }, [qc])

  const prefetchTokens = useCallback(
    (chain: string) => {
      afterInteractions(() => {
        void qc.prefetchQuery({
          queryKey: queryKeys.tokens(chain),
          queryFn: () => endpoints.tokens(chain),
          staleTime: STALE.config,
        })
      })
    },
    [qc],
  )

  return { prefetchPortfolio, prefetchSwaps, prefetchTokens }
}
