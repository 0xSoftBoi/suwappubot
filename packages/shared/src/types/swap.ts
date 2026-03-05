/**
 * Swap-related types for Suwappu
 * Extracted from webapp/src/types/swap.ts for cross-platform use
 */

export interface SwapToken {
  symbol: string
  name: string
  address: string
  chain: string
  decimals: number
  logoUrl?: string
  balance?: string
  balanceUsd?: number
}

export interface SwapQuoteRequest {
  fromToken: string
  toToken: string
  fromChain: string
  toChain: string
  amount: string
  fromDecimals: number
  slippage?: number
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
  priceImpact: number
  estimatedGas: string
  gasUsd: number
  route: string
  expiresAt: string
  minReceived: string
  slippage: number
  estimatedDuration?: number
}

export interface SwapExecuteRequest {
  quoteId: string
}

export interface SwapExecuteResult {
  success: boolean
  swapId: number
  status: 'signed' | 'submitted' | 'completed' | 'failed'
  txHash?: string
  explorerUrl?: string
  swap: {
    fromChain: string
    toChain: string
    fromToken: string
    toToken: string
    fromAmount: string
    expectedToAmount: string
  }
}

export interface SwapStatusResponse {
  id: number
  status: 'pending' | 'signed' | 'submitted' | 'completed' | 'failed'
  fromChain: string
  toChain: string
  fromToken: string
  toToken: string
  fromAmount: string
  toAmount: string | null
  txHash: string | null
  bridgeTxHash: string | null
  destinationTxHash: string | null
  errorMessage: string | null
  createdAt: string
  completedAt: string | null
}
