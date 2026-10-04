import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { api } from '../lib/api'
import type { SwapQuoteRequest } from '../types/swap'
import { useDebouncedValue } from './useDebouncedValue'

/**
 * Hook to fetch swap quote with input-level debouncing.
 *
 * Casino-grade: debounce the *request* (200ms after the user stops typing),
 * then fire the query immediately. Never sleep inside the queryFn — that
 * burns 500ms on every keystroke even when the user keeps typing.
 *
 * @param request - Quote request parameters
 * @param enabled - Whether to enable the query
 */
export function useSwapQuote(
  request: Partial<SwapQuoteRequest> | null,
  enabled = true
) {
  // Debounce at the input level so fast typing doesn't spam the quote API,
  // but the query itself starts the instant the user pauses.
  const debouncedRequest = useDebouncedValue(request, 200)

  // Validate request has required fields
  const isValidRequest = useMemo(() => {
    if (!debouncedRequest) return false
    const { fromToken, toToken, fromChain, toChain, amount } = debouncedRequest

    // Must have all required fields
    if (!fromToken || !toToken || !fromChain || !toChain || !amount) return false

    // Amount must be valid number > 0
    const amountNum = parseFloat(amount)
    if (isNaN(amountNum) || amountNum <= 0) return false

    // Tokens must be different
    if (fromToken === toToken && fromChain === toChain) return false

    return true
  }, [debouncedRequest])

  const queryKey = useMemo(() => {
    if (!debouncedRequest) return ['swap-quote', null]
    return [
      'swap-quote',
      debouncedRequest.fromToken,
      debouncedRequest.toToken,
      debouncedRequest.fromChain,
      debouncedRequest.toChain,
      debouncedRequest.amount,
      debouncedRequest.slippage,
    ]
  }, [debouncedRequest])

  return useQuery({
    queryKey,
    queryFn: () => api.getSwapQuote(debouncedRequest as SwapQuoteRequest),
    enabled: enabled && isValidRequest,
    staleTime: 10 * 1000, // 10 seconds - quotes expire quickly
    gcTime: 30 * 1000, // 30 seconds cache
    retry: 1,
    refetchOnWindowFocus: false,
    // Keep the previous quote visible while the new one loads — no flicker
    // to empty state on every keystroke.
    placeholderData: (prev) => prev,
  })
}
