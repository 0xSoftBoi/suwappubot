import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { api } from '../lib/api'
import type { SwapQuoteRequest } from '../types/swap'

/**
 * Debounce delay for quote requests (ms)
 */
const QUOTE_DEBOUNCE_MS = 500

/**
 * Hook to fetch swap quote with automatic debouncing
 * 
 * @param request - Quote request parameters
 * @param enabled - Whether to enable the query
 */
export function useSwapQuote(
  request: Partial<SwapQuoteRequest> | null,
  enabled = true
) {
  // Validate request has required fields
  const isValidRequest = useMemo(() => {
    if (!request) return false
    const { fromToken, toToken, fromChain, toChain, amount } = request
    
    // Must have all required fields
    if (!fromToken || !toToken || !fromChain || !toChain || !amount) return false
    
    // Amount must be valid number > 0
    const amountNum = parseFloat(amount)
    if (isNaN(amountNum) || amountNum <= 0) return false
    
    // Tokens must be different
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
      // Add artificial delay for debouncing
      await new Promise(resolve => setTimeout(resolve, QUOTE_DEBOUNCE_MS))
      return api.getSwapQuote(request as SwapQuoteRequest)
    },
    enabled: enabled && isValidRequest,
    staleTime: 10 * 1000, // 10 seconds - quotes expire quickly
    gcTime: 30 * 1000, // 30 seconds cache
    retry: 1,
    refetchOnWindowFocus: false,
  })
}
