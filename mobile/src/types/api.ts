/**
 * Response shapes from api-ts. Mirrors webapp/src/types/api.ts — kept as a
 * local copy because the webapp types are Vite/DOM-flavoured and there is no
 * shared package yet. If `packages/shared` lands, delete this and import.
 */

export interface Token {
  symbol: string
  name: string
  address: string
  chain: string
  balance: string
  usdValue: number
  logoUrl?: string
  decimals?: number
}

export interface Portfolio {
  totalUsdValue: number
  tokens: Token[]
  lastUpdated: string
}

export type SwapStatus = 'pending' | 'completed' | 'failed' | 'cancelled'

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
  status: SwapStatus
  txHash?: string
  createdAt: string
  completedAt?: string
  errorMessage?: string
}

export interface Wallet {
  address: string
  chain: string
}

export interface SwapQuote {
  quoteId: string
  fromAmount: string
  toAmount: string
  priceImpact?: number
  estimatedGasUsd?: number
  route?: string
  expiresAt?: string
}

export interface HealthStatus {
  status: 'ok' | 'degraded' | 'error'
  service: string
  timestamp?: string
}
