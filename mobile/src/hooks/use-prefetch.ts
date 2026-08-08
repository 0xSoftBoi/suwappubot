import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { endpoints } from '../lib/endpoints'
import { getAuthRevision } from '../lib/auth'
import { queryKeys } from '../lib/queryKeys'
import { STALE } from '../lib/queryClient'
import { afterInteractions } from '../lib/perf'

export function usePrefetch() {
  const qc = useQueryClient()

  const prefetchSnapshot = useCallback(() => {
    afterInteractions(() => {
      const authRevision = getAuthRevision()
      void qc.prefetchQuery({
        queryKey: queryKeys.snapshot(authRevision),
        queryFn: ({ signal }) => endpoints.snapshot(signal),
        staleTime: STALE.balance,
      })
    })
  }, [qc])

  const prefetchActivity = useCallback(() => {
    afterInteractions(() => {
      const authRevision = getAuthRevision()
      void qc.prefetchQuery({
        queryKey: queryKeys.activity(authRevision, 20, 0),
        queryFn: ({ signal }) => endpoints.activity(20, 0, signal),
        staleTime: STALE.activity,
      })
    })
  }, [qc])

  return { prefetchSnapshot, prefetchActivity }
}
