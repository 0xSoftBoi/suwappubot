import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import type { ApiError } from '../types/api'

const DEVWATCH_LIST_KEY = ['token-intel', 'devwatch', 'list'] as const
const DEVWATCH_HITS_KEY = ['token-intel', 'devwatch', 'hits'] as const

const MAX_RATE_LIMIT_RETRIES = 2
const DEFAULT_RETRY_DELAY_MS = 4_000

// /terminal/intel/* is per-IP rate limited (429 + Retry-After). Back off
// exactly as told instead of hammering it — cap at a couple of bounded
// retries so a persistent 429 surfaces the friendly rate-limit state rather
// than looping quietly forever.
function intelRetry(failureCount: number, error: unknown): boolean {
  const status = (error as Partial<ApiError> | undefined)?.status
  if (status === 429) return failureCount < MAX_RATE_LIMIT_RETRIES
  // Other 4xx (bad address, not found, auth) are not transient — don't retry.
  if (typeof status === 'number' && status >= 400 && status < 500) return false
  return failureCount < 1
}

function intelRetryDelay(attemptIndex: number, error: unknown): number {
  const retryAfter = (error as Partial<ApiError> | undefined)?.retryAfter
  if (typeof retryAfter === 'number' && retryAfter > 0) return retryAfter * 1000
  return Math.min(DEFAULT_RETRY_DELAY_MS * 2 ** attemptIndex, 15_000)
}

// Single-token intel lookup. Disabled until both chain + address are present
// so the panel doesn't fire on an empty input. Not too aggressive on refetch —
// deployer/holder data doesn't change second to second.
export function useTokenIntel(chain: string, tokenAddress: string) {
  return useQuery({
    queryKey: ['token-intel', chain, tokenAddress],
    queryFn: () => api.getTokenIntel(chain, tokenAddress),
    enabled: Boolean(chain && tokenAddress),
    staleTime: 30_000,
    retry: intelRetry,
    retryDelay: intelRetryDelay,
  })
}

export function useDevWatchList() {
  return useQuery({
    queryKey: DEVWATCH_LIST_KEY,
    queryFn: () => api.getDevWatchList(),
    staleTime: 15_000,
  })
}

export function useDevWatchHits(limit = 50) {
  return useQuery({
    queryKey: [...DEVWATCH_HITS_KEY, limit],
    queryFn: () => api.getDevWatchHits(limit),
    staleTime: 15_000,
    refetchInterval: 60_000,
  })
}

export function useAddDevWatch() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (params: { deployer_address: string; chain: string; label?: string }) =>
      api.addDevWatch(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: DEVWATCH_LIST_KEY })
    },
  })
}

export function useRemoveDevWatch() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (watchId: number) => api.removeDevWatch(watchId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: DEVWATCH_LIST_KEY })
    },
  })
}
