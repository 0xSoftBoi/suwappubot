export interface SnipeRequest {
  tokenAddress: string
  chain: string
  amount: string // Amount in native token (SOL/ETH)
  slippage?: number // Default 1%
  maxGas?: string // Max gas willing to pay
}

export interface SnipeResult {
  id: number
  status: 'submitted' | 'completed' | 'failed'
  txHash?: string
  explorerUrl?: string
  tokenAmount?: string
  tokenSymbol?: string
  spentAmount: string
  spentSymbol: string
}

export interface LaunchToken {
  id: string
  address: string
  symbol: string
  name: string
  chain: string
  launchedAt: string
  marketCap: number
  safetyScore: number
  bondingCurvePercent: number
  price?: number
  logoUrl?: string
}
