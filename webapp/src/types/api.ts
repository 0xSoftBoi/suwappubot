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
  decimals?: number
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

// User preferences (settings page)
export interface UserPreferences {
  defaultSlippage: number // basis points: 50 = 0.5%
  notificationsEnabled: boolean
  twoFaEnabled: boolean
  twoFaThreshold: number
  gasMode: string
}

export interface UserProfile {
  id: number
  telegramId?: number
  username?: string
  firstName?: string
  lastName?: string
}

export interface LinkedWalletInfo {
  address: string
  name: string
  chainType: 'evm' | 'solana'
  provider: 'local' | 'turnkey' | 'external'
  isDefault: boolean
  linkedAt: string
}

export interface UserPreferencesResponse {
  user: UserProfile
  preferences: UserPreferences
  wallets: LinkedWalletInfo[]
}

export interface UpdatePreferencesResponse {
  success: boolean
  preferences: UserPreferences
}

// Portfolio PnL analytics

export interface PnlDataPoint {
  date: string // YYYY-MM-DD
  pnl: number // daily PnL USD
  cumulativePnl: number
  tradeCount: number
}

export type TicketKind = 'support' | 'bug'
export type TicketStatus = 'open' | 'in_progress' | 'resolved' | 'closed'

export interface SupportTicket {
  id: string
  kind: TicketKind
  status: TicketStatus
  message: string
  category?: string
  adminReply?: string
  createdAt: string
}

export interface ChainPnl {
  chain: string
  pnl: number
  tradeCount: number
}

export interface PortfolioPnl {
  period: '7d' | '30d' | '90d' | 'all'
  totalPnl: number
  realizedPnl: number
  winRate: number
  wins: number
  losses: number
  totalTrades: number
  avgTradeSize: number
  gasPaidUsd: number
  feesSavedUsd: number
  dataPoints: PnlDataPoint[]
  chainBreakdown: ChainPnl[]
}
