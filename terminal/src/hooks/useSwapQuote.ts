import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { api } from '../lib/api'
import { waitForIntent } from '../lib/intentDelay'
import type { SwapQuoteRequest } from '../types/api'

export function useSwapQuote(
  request: Partial<SwapQuoteRequest> | null,
  enabled = true
) {
  const isValidRequest = useMemo(() => {
    if (!request) return false
    const { fromToken, toToken, fromChain, toChain, amount } = request
    if (!fromToken || !toToken || !fromChain || !toChain || !amount) return false
    const amountNum = parseFloat(amount)
    if (isNaN(amountNum) || amountNum <= 0) return false
    if (fromToken === toToken && fromChain === toChain) return false
    return true
  }, [request])

  const queryKey = useMemo(() => {
    if (!request) return ['swap-quote', null]
    return [
      'swap-quote',
      request.fromToken,
      request.toToken,
      request.fromChain,
      request.toChain,
      request.amount,
      request.slippage,
    ]
  }, [request])

  return useQuery({
    queryKey,
    queryFn: async ({ signal }) => {
      await waitForIntent(signal)
      return api.getSwapQuote(request as SwapQuoteRequest, signal)
    },
    enabled: enabled && isValidRequest,
    staleTime: 10_000,
    gcTime: 30_000,
    retry: 1,
    refetchOnWindowFocus: false,
  })
}
