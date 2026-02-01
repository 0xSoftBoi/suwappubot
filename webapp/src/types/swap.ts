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
  amount: string     // human-readable amount (e.g. "1.5")
  fromDecimals: number  // decimals of fromToken, used to convert to wei
  slippage?: number  // percentage, e.g. 0.5 for 0.5%
}

export interface SwapQuote {
  /** Quote identifier - API returns as quoteId */
  quoteId: string
  /** Legacy field name - some code uses id */
  id?: string
  fromToken: {
    address: string
    symbol: string
    decimals: number
    logoURI?: string
  }
  toToken: {
    address: string
    symbol: string
    decimals: number
    logoURI?: string
  }
  fromChain: string
  toChain: string
  fromAmount: string
  toAmount: string
  toAmountMin: string
  fromAmountUsd?: number
  toAmountUsd?: number
  exchangeRate: string
  priceImpact: string  // percentage as string
  estimatedGas: string
  estimatedGasUsd: string
  bridgeFee?: string
  bridgeFeeUsd?: string
  route: string
  slippage: number
  estimatedDuration?: number  // seconds
  txData?: {
    to: string
    value: string
    chainId: number
    gasLimit: string
  }
}

export interface SwapExecuteRequest {
  quoteId: string
}

export interface SwapExecuteResult {
  success: boolean
  swapId: number
  status: 'signed'
  signedTransaction: string
  message: string
  chain: {
    chainId: number
    rpcNeeded: boolean
  }
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
  status: 'pending' | 'signed' | 'completed' | 'failed'
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
