/**
 * Token sniping types
 */

export type SnipeMode = 'instant' | 'conditional' | 'first_block'
export type SnipePlatform = 'pump_fun' | 'raydium' | 'any'
export type SnipeStatus = 'pending' | 'watching' | 'executing' | 'executed' | 'failed' | 'cancelled'

export interface SnipeOrder {
  id: number
  tokenAddress?: string
  tokenSymbol?: string
  platform: SnipePlatform
  mode: SnipeMode
  amountSol: string
  slippage: number
  jitoTipLamports?: number
  useMevProtection: boolean
  status: SnipeStatus
  txSignature?: string
  tokensReceived?: string
  executedAt?: string
  createdAt: string
}

export interface CreateSnipeRequest {
  tokenAddress?: string
  platform: SnipePlatform
  mode: SnipeMode
  amountSol: string
  slippage?: number
  jitoTipLamports?: number
  useMevProtection?: boolean
}

export interface SnipeConfig {
  quickAmounts: number[]
  defaultSlippage: number
  defaultJitoTip: number
  autoSnipeEnabled: boolean
  maxAutoSnipePerDay: number
}

export interface SnipeHistory {
  id: number
  tokenAddress: string
  tokenSymbol: string
  amountSol: string
  tokensReceived: string
  entryPrice: number
  currentPrice?: number
  athPrice?: number
  pnl?: number
  pnlPercent?: number
  executedAt: string
}

export interface AutoSnipeRule {
  id: number
  name: string
  platform: SnipePlatform
  minLiquidity?: number
  maxMarketCap?: number
  amountSol: string
  isActive: boolean
  triggeredCount: number
  createdAt: string
}

export interface WatchedToken {
  id: number
  tokenAddress: string
  tokenSymbol?: string
  platform: string
  isMigrated: boolean
  migratedAt?: string
  addedAt: string
}
