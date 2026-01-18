/**
 * API response types for Suwappu
 */

export interface Token {
  symbol: string
  name: string
  address: string
  chain: string
  balance: string
  usdValue: number
  logoUrl?: string
}

export interface Portfolio {
  totalUsdValue: number
  tokens: Token[]
  lastUpdated: string
}

export interface Swap {
  id: string
  fromChain: string
  toChain: string
  fromToken: string
  toToken: string
  fromAmount: string
  toAmount?: string
  fromAmountUsd?: number
  toAmountUsd?: number
  status: 'pending' | 'completed' | 'failed' | 'cancelled'
  txHash?: string
  bridgeTxHash?: string
  destinationTxHash?: string
  createdAt: string
  completedAt?: string
  errorMessage?: string
}

export interface User {
  id: number
  telegramId?: number
  username?: string
  firstName?: string
  lastName?: string
}

export interface ApiError {
  detail: string
  status: number
}

export interface HealthStatus {
  status: 'ok' | 'degraded' | 'error'
  service: string
  timestamp?: string
}
