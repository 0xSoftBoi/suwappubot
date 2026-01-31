/**
 * Swap-related types for Suwappu
 */

export interface SwapToken {
  symbol: string
  name: string
  address: string
  chain: string
  decimals: number
  logoUrl?: string
  /** User's balance (may be undefined if not fetched) */
  balance?: string
  /** USD value of user's balance */
  balanceUsd?: number
}

export interface SwapQuoteRequest {
  fromToken: string  // address
  toToken: string    // address
  fromChain: string
  toChain: string
  amount: string
  slippage?: number  // percentage, e.g. 0.5 for 0.5%
}

export interface SwapQuote {
  id: string
  fromToken: SwapToken
  toToken: SwapToken
  fromAmount: string
  toAmount: string
  fromAmountUsd: number
  toAmountUsd: number
  exchangeRate: number
  priceImpact: number  // percentage
  estimatedGas: string
  gasUsd: number
  route: string
  expiresAt: string
  minReceived: string
  slippage: number
}

export interface SwapExecuteRequest {
  quoteId: string
  walletAddress: string
}

export interface SwapExecuteResult {
  swapId: string
  txHash: string
  status: 'pending' | 'submitted'
}
