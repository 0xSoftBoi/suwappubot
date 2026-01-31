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

// User preferences (settings page)
export interface UserPreferences {
  defaultSlippage: number // basis points: 50 = 0.5%
  notificationsEnabled: boolean
  twoFaEnabled: boolean
  twoFaThreshold: number
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
