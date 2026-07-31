/**
 * Data hooks. Every hook picks a staleTime class from queryClient.STALE and
 * forwards the AbortSignal Query provides, so navigating away actually cancels
 * the socket instead of leaving it to drain in the background.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { endpoints } from '../lib/endpoints'
import { queryKeys } from '../lib/queryKeys'
import { STALE } from '../lib/queryClient'
import type { Portfolio, Swap, SwapQuote, Token, Wallet } from '../types/api'

export function usePortfolio() {
  return useQuery<Portfolio>({
    queryKey: queryKeys.portfolio(),
    queryFn: ({ signal }) => endpoints.portfolio(signal),
    staleTime: STALE.balance,
  })
}

export function useWallet() {
  return useQuery<Wallet>({
    queryKey: queryKeys.wallet(),
    queryFn: () => endpoints.wallet(),
    staleTime: STALE.config,
  })
}

export function useSwaps(limit = 20, offset = 0) {
  return useQuery<Swap[]>({
    queryKey: queryKeys.swaps(limit, offset),
    queryFn: ({ signal }) => endpoints.swaps(limit, offset, signal),
    staleTime: STALE.activity,
  })
}

export function useTokens(chain: string) {
  return useQuery<Token[]>({
    queryKey: queryKeys.tokens(chain),
    queryFn: () => endpoints.tokens(chain),
    staleTime: STALE.config,
    enabled: Boolean(chain),
  })
}

/**
 * Live quote. Refetches on an interval only while the screen is focused and
 * the app is foregrounded — `refetchIntervalInBackground: false` is what stops
 * the swap screen from polling the quote API all night in the user's pocket.
 */
export function useQuote(
  params: { fromChain: string; toChain: string; fromToken: string; toToken: string; amount: string } | null,
) {
  return useQuery<SwapQuote>({
    queryKey: queryKeys.quote(params ?? {}),
    queryFn: ({ signal }) => endpoints.quote(params!, signal),
    enabled: Boolean(params && Number(params.amount) > 0),
    staleTime: STALE.realtime,
    refetchInterval: 10_000,
    refetchIntervalInBackground: false,
    // A refreshing quote should not blank the screen.
    placeholderData: (previous) => previous,
  })
}

/**
 * Poll an in-flight swap until it settles, then stop. An unbounded poll is a
 * battery leak; the `refetchInterval` callback returning false is the fix.
 */
export function useSwapStatus(swapId: string | null) {
  return useQuery<Swap>({
    queryKey: queryKeys.swapStatus(swapId ?? ''),
    queryFn: () => endpoints.swapStatus(swapId!),
    enabled: Boolean(swapId),
    refetchInterval: (query) => {
      const status = query.state.data?.status
      return status === 'pending' ? 4_000 : false
    },
    refetchIntervalInBackground: false,
  })
}

export function useExecuteSwap() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { quoteId: string }) => endpoints.executeSwap(body),
    onSuccess: () => {
      // Targeted invalidation — balances and history changed, config did not.
      void qc.invalidateQueries({ queryKey: queryKeys.portfolio() })
      void qc.invalidateQueries({ queryKey: ['swaps'] })
    },
  })
}
