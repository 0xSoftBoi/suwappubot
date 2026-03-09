import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { api } from '../lib/api'
import type { SwapQuoteRequest } from '../types/api'

const QUOTE_DEBOUNCE_MS = 500

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
    queryFn: async () => {
      await new Promise(resolve => setTimeout(resolve, QUOTE_DEBOUNCE_MS))
      return api.getSwapQuote(request as SwapQuoteRequest)
    },
    enabled: enabled && isValidRequest,
    staleTime: 10_000,
    gcTime: 30_000,
    retry: 1,
    refetchOnWindowFocus: false,
  })
}
