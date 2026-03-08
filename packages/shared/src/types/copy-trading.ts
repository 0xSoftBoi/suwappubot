/**
 * Copy trading types
 */

export type CopyMode = 'notify' | 'auto'
export type CopyType = 'fixed_amount' | 'percentage'

export interface TraderProfile {
  id: number
  userId: number
  displayName: string
  bio?: string
  emoji?: string
  isPublic: boolean
  totalTrades: number
  winRate: number
  totalPnl: number
  bestTrade: number
  worstTrade: number
  followerCount: number
  timesCopied: number
  rankScore: number
  createdAt: string
}

export interface CopyFollow {
  id: number
  traderId: number
  traderName: string
  copyMode: CopyMode
  copyType: CopyType
  copyAmount?: string
  copyPercentage?: number
  maxPerTrade?: string
  dailyLimit?: string
  totalCopied: number
  totalPnl: number
  isActive: boolean
  createdAt: string
}

export interface FollowTraderRequest {
  copyMode: CopyMode
  copyType: CopyType
  copyAmount?: string
  copyPercentage?: number
  maxPerTrade?: string
  dailyLimit?: string
}

export interface CopyTrade {
  id: number
  traderId: number
  traderName: string
  fromToken: string
  toToken: string
  fromChain: string
  fromAmount: string
  toAmount?: string
  pnl?: number
  status: 'pending' | 'executed' | 'failed' | 'skipped'
  createdAt: string
}
