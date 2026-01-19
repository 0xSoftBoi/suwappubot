import { useQuery } from '@tanstack/react-query'
import { api, type QuoteResponse } from '../lib/api'

export interface UseQuoteParams {
  fromChain: string
  toChain: string
  fromToken: string
  toToken: string
  fromAmount: string
  slippage?: number
  enabled?: boolean
}

/**
 * Hook to fetch swap quotes from the API
 * Only fetches when amount > 0 and enabled is true
 */
export function useQuote({
  fromChain,
  toChain,
  fromToken,
  toToken,
  fromAmount,
  slippage = 0.5,
  enabled = true,
}: UseQuoteParams) {
  const parsedAmount = parseFloat(fromAmount || '0')
  const shouldFetch = enabled && parsedAmount > 0 && !!fromToken && !!toToken

  return useQuery<QuoteResponse>({
    queryKey: ['quote', fromChain, toChain, fromToken, toToken, fromAmount, slippage],
    queryFn: async () => {
      // Convert human-readable amount to base units (wei)
      // For simplicity, assume 18 decimals - in production, use token decimals
      const decimals = fromToken === 'USDC' || fromToken === 'USDT' ? 6 : 18
      const baseAmount = BigInt(Math.floor(parsedAmount * Math.pow(10, decimals))).toString()

      return api.getQuote({
        fromChain,
        toChain,
        fromToken,
        toToken,
        fromAmount: baseAmount,
        slippage,
      })
    },
    enabled: shouldFetch,
    staleTime: 10 * 1000, // 10 seconds
    refetchInterval: 15 * 1000, // Refresh every 15 seconds
    retry: 1,
  })
}

/**
 * Hook to fetch supported tokens for a chain
 */
export function useTokens(chain?: string) {
  return useQuery({
    queryKey: ['tokens', chain],
    queryFn: () => api.getTokens(chain),
    staleTime: 5 * 60 * 1000, // 5 minutes
  })
}

/**
 * Format token amount from base units to human readable
 */
export function formatTokenAmount(amount: string, decimals: number): string {
  const value = BigInt(amount)
  const divisor = BigInt(10 ** decimals)
  const whole = value / divisor
  const fraction = value % divisor

  if (fraction === 0n) {
    return whole.toString()
  }

  const fractionStr = fraction.toString().padStart(decimals, '0')
  // Trim trailing zeros but keep at least 2 decimal places
  const trimmed = fractionStr.replace(/0+$/, '')
  const finalFraction = trimmed.length < 2 ? fractionStr.slice(0, 2) : trimmed

  return `${whole}.${finalFraction}`
}
