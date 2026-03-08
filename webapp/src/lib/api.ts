/**
 * API client for Suwappu webapp
 *
 * Extends the shared BaseApiClient with webapp-specific auth:
 * - Telegram initData (primary for Mini App)
 * - JWT token (for Turnkey wallet auth)
 * - CSRF token for state-changing requests
 * - Dev mode support
 */
import { BaseApiClient } from '@suwappu/shared'
import { getInitData } from './telegram'
import { getAuthToken, clearAuthToken } from './auth'
import type { SwapStatusResponse } from '@suwappu/shared'

const API_BASE = import.meta.env.VITE_API_URL || ''

class WebappApiClient extends BaseApiClient {
  /**
   * Build auth headers for requests.
   * Includes both Telegram initData and JWT if available.
   * Falls back to dev mode for browser testing.
   */
  protected getAuthHeaders(): Record<string, string> {
    const headers: Record<string, string> = {}

    // Add Telegram auth header if available (primary for Mini App)
    const initData = getInitData()
    if (initData) {
      headers['X-Telegram-Init-Data'] = initData
    }

    // Add JWT token if available (for Turnkey sessions)
    const token = getAuthToken()
    if (token) {
      headers['Authorization'] = `Bearer ${token}`
    }

    // Dev mode: Only add dev header in actual development builds, never in production
    if (import.meta.env.DEV) {
      const isDev = this.baseUrl.includes('localhost') || this.baseUrl.includes('127.0.0.1')
      if (isDev) {
        headers['X-Dev-User-Id'] = '12345'
      }
    }

    return headers
  }

  private getCsrfToken(): string | null {
    const match = document.cookie.match(/(^|;\s*)suwappu_csrf=([^;]+)/)
    return match ? decodeURIComponent(match[2]) : null
  }

  /**
   * Override fetch to add CSRF token and handle 401 errors
   */
  protected async fetch<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const method = (options.method || 'GET').toUpperCase()
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...this.getAuthHeaders(),
      ...(options.headers as Record<string, string>),
    }

    // Add CSRF token for state-changing requests
    if (method !== 'GET' && method !== 'HEAD') {
      const csrf = this.getCsrfToken()
      if (csrf) {
        headers['X-CSRF-Token'] = csrf
      }
    }

    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      ...options,
      headers,
    })

    if (!response.ok) {
      // Handle expired/invalid auth tokens
      if (response.status === 401) {
        clearAuthToken()
      }

      const error = {
        detail: 'Request failed',
        status: response.status,
      }

      try {
        const body = await response.json()
        error.detail = body.detail || body.message || 'Request failed'
      } catch {
        // Ignore JSON parse errors
      }

      throw error
    }

    return response.json()
  }

  // === Webapp-specific endpoints ===

  /**
   * Validate Telegram init data (for testing auth)
   */
  async validateAuth(): Promise<{ valid: boolean; user?: unknown }> {
    return this.fetch('/webapp/validate', { method: 'POST' })
  }

  /**
   * Get a specific swap by ID
   */
  async getSwap(id: string): Promise<SwapStatusResponse> {
    return this.fetch<SwapStatusResponse>(`/webapp/swap/status/${id}`)
  }

  /**
   * Get swap status (typed for polling)
   */
  async getSwapStatus(swapId: string): Promise<SwapStatusResponse> {
    return this.fetch<SwapStatusResponse>(`/webapp/swap/status/${swapId}`)
  }

  /**
   * Get available tokens for swapping with optional balance info
   */
  async getTokensWithBalances(chainId = '1', includeBalances = true): Promise<SwapToken[]> {
    const headers: Record<string, string> = {
      'Accept': 'application/json',
    }
    if (includeBalances) {
      Object.assign(headers, this.getAuthHeaders())
    }

    const response = await fetch(`${this.baseUrl}/webapp/swap/tokens?chainId=${chainId}`, { headers })
    if (!response.ok) throw new Error('Failed to fetch tokens')
    const data = await response.json()

    return data.tokens.map((t: TokenResponse) => ({
      symbol: t.symbol,
      name: t.name,
      address: t.address,
      chain: chainId,
      decimals: t.decimals,
      logoUrl: t.logoURI || t.logoUrl,
      balance: t.balance || undefined,
    }))
  }

  /**
   * Get chains list from webapp endpoint
   */
  async getChainsForSwap(): Promise<{ id: number; key: string; name: string }[]> {
    const response = await fetch(`${this.baseUrl}/webapp/swap/chains`)
    if (!response.ok) throw new Error('Failed to fetch chains')
    const data = await response.json()
    return data.chains
  }

  // === Points & Rewards (webapp-specific endpoints) ===

  /**
   * Get user's points stats
   */
  async getPointsStats(): Promise<PointsStats> {
    return this.fetch<PointsStats>('/webapp/me/points/stats')
  }

  /**
   * Daily check-in (webapp endpoint)
   */
  async webappCheckin(): Promise<CheckinResult> {
    return this.fetch<CheckinResult>('/webapp/me/points/checkin', { method: 'POST' })
  }

  /**
   * Get points transaction history
   */
  async getPointsHistory(limit = 20, offset = 0): Promise<WebappPointTransaction[]> {
    return this.fetch<WebappPointTransaction[]>(`/webapp/me/points/history?limit=${limit}&offset=${offset}`)
  }

  /**
   * Get leaderboard (webapp endpoint)
   */
  async getWebappLeaderboard(limit = 10): Promise<WebappLeaderboardEntry[]> {
    return this.fetch<WebappLeaderboardEntry[]>(`/webapp/me/points/leaderboard?limit=${limit}`)
  }

  /**
   * Get available rewards
   */
  async getWebappRewards(): Promise<WebappReward[]> {
    return this.fetch<WebappReward[]>('/webapp/me/points/rewards')
  }

  /**
   * Redeem a reward
   */
  async redeemWebappReward(rewardId: number): Promise<RedemptionResult> {
    return this.fetch<RedemptionResult>(`/webapp/me/points/redeem/${rewardId}`, { method: 'POST' })
  }

  // === Wallet Send ===

  /**
   * Send tokens from a wallet to another address
   */
  async sendTransaction(request: SendTransactionRequest): Promise<{ txHash: string; status: string }> {
    return this.fetch('/webapp/wallets/send', {
      method: 'POST',
      body: JSON.stringify(request),
    })
  }

  // === Limit Orders (webapp-specific endpoints) ===

  /**
   * Get user's limit orders
   */
  async getWebappLimitOrders(status?: string, limit = 20, offset = 0): Promise<WebappLimitOrder[]> {
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset) })
    if (status) params.set('status', status)
    return this.fetch<WebappLimitOrder[]>(`/webapp/me/limit-orders?${params}`)
  }

  /**
   * Create a new limit order
   */
  async createWebappLimitOrder(request: CreateLimitOrderRequest): Promise<CreateLimitOrderResult> {
    return this.fetch<CreateLimitOrderResult>('/webapp/me/limit-orders', {
      method: 'POST',
      body: JSON.stringify(request),
    })
  }

  /**
   * Cancel a limit order
   */
  async cancelWebappLimitOrder(orderId: number): Promise<{ id: number; status: string; message: string }> {
    return this.fetch(`/webapp/me/limit-orders/${orderId}`, { method: 'DELETE' })
  }

  // === Token Discovery ===

  /**
   * Get trending tokens, optionally filtered by chain
   */
  async getTrendingTokens(chain?: string): Promise<TrendingToken[]> {
    const params = chain ? `?chain=${chain}` : ''
    return this.fetch<TrendingToken[]>(`/webapp/tokens/trending${params}`)
  }

  /**
   * Get token info (pairs data from DexScreener)
   */
  async getTokenInfo(chain: string, address: string): Promise<TokenInfoResponse> {
    return this.fetch<TokenInfoResponse>(`/webapp/tokens/${chain}/${address}/info`)
  }

  /**
   * Get token chart data (OHLCV candles)
   */
  async getTokenChart(chain: string, address: string, timeframe: string = '1h'): Promise<TokenChartResponse> {
    return this.fetch<TokenChartResponse>(`/webapp/tokens/${chain}/${address}/chart?timeframe=${timeframe}`)
  }

  // === Copy Trading ===

  async getTopTraders(filters?: { minTrades?: number; minWinRate?: number; chain?: string; sortBy?: string }): Promise<CopyTraderEntry[]> {
    const params = new URLSearchParams()
    if (filters?.minTrades) params.set('minTrades', String(filters.minTrades))
    if (filters?.minWinRate) params.set('minWinRate', String(filters.minWinRate))
    if (filters?.chain) params.set('chain', filters.chain)
    if (filters?.sortBy) params.set('sortBy', filters.sortBy)
    return this.fetch<CopyTraderEntry[]>(`/webapp/me/copy/top-traders?${params}`)
  }

  async getTraderProfile(id: number): Promise<CopyTraderProfile> {
    return this.fetch<CopyTraderProfile>(`/webapp/me/copy/trader/${id}`)
  }

  async getWebappFollowing(): Promise<CopyFollowingEntry[]> {
    return this.fetch<CopyFollowingEntry[]>('/webapp/me/copy/following')
  }

  async getWebappCopyTrades(limit = 20, offset = 0): Promise<CopyTradeRecord[]> {
    return this.fetch<CopyTradeRecord[]>(`/webapp/me/copy/trades?limit=${limit}&offset=${offset}`)
  }

  async webappFollowTrader(traderId: number, settings: CopyFollowSettings): Promise<unknown> {
    return this.fetch('/webapp/me/copy/follow/' + traderId, {
      method: 'POST',
      body: JSON.stringify(settings),
    })
  }

  async unfollowTrader(traderId: number): Promise<{ success: boolean; message: string }> {
    return this.fetch(`/webapp/me/copy/follow/${traderId}`, { method: 'DELETE' })
  }

  async updateCopySettings(traderId: number, settings: CopyFollowSettings): Promise<unknown> {
    return this.fetch(`/webapp/me/copy/follow/${traderId}`, {
      method: 'PUT',
      body: JSON.stringify(settings),
    })
  }

  // === User Preferences (webapp-specific endpoints) ===

  /**
   * Get user preferences (webapp endpoint)
   */
  async getWebappPreferences(): Promise<WebappUserPreferencesResponse> {
    return this.fetch<WebappUserPreferencesResponse>('/webapp/me/preferences')
  }

  /**
   * Update user preferences (webapp endpoint)
   */
  async updateWebappPreferences(preferences: Partial<WebappUserPreferences>): Promise<WebappUpdatePreferencesResponse> {
    return this.fetch<WebappUpdatePreferencesResponse>('/webapp/me/preferences', {
      method: 'PUT',
      body: JSON.stringify(preferences),
    })
  }
}

// Webapp-specific types for endpoints that differ from shared types
interface TokenResponse {
  symbol: string
  name: string
  address: string
  decimals: number
  logoURI?: string
  logoUrl?: string
  balance?: string
}

interface SwapToken {
  symbol: string
  name: string
  address: string
  chain: string
  decimals: number
  logoUrl?: string
  balance?: string
}

interface PointsStats {
  totalPoints: number
  currentStreak: number
  longestStreak: number
  lastCheckin: string | null
  canCheckin: boolean
  rank?: number
}

interface CheckinResult {
  success: boolean
  pointsAwarded: number
  newTotal: number
  streak: number
  bonusPoints?: number
}

interface WebappPointTransaction {
  id: number
  amount: number
  action: string
  description: string | null
  createdAt: string
}

interface WebappLeaderboardEntry {
  rank: number
  userId: number
  username: string | null
  firstName: string | null
  totalPoints: number
  currentStreak: number
}

interface WebappReward {
  id: number
  name: string
  description: string
  emoji: string
  pointsCost: number
  rewardType: string
  rewardValue: string | null
  stock: number | null
}

interface RedemptionResult {
  id: number
  pointsSpent: number
  rewardType: string
  rewardValue: string | null
  status: string
  expiresAt: string | null
}

interface WebappLimitOrder {
  id: number
  fromChain: string
  fromToken: string
  fromTokenSymbol: string
  fromAmount: string
  toChain: string
  toToken: string
  toTokenSymbol: string
  targetPrice: number
  currentPrice: number | null
  triggerType: 'lte' | 'gte'
  status: 'active' | 'filled' | 'cancelled' | 'expired' | 'failed'
  createdAt: string | null
  expiresAt: string | null
  executedAt: string | null
  executedPrice: number | null
  executedTxHash: string | null
}

interface CreateLimitOrderRequest {
  fromChain: string
  fromToken: string
  fromTokenSymbol: string
  fromAmount: string
  toChain: string
  toToken: string
  toTokenSymbol: string
  targetPrice: number
  triggerType?: 'lte' | 'gte'
  slippage?: number
  walletAddress: string
  expiresInHours?: number
}

interface CreateLimitOrderResult {
  id: number
  status: string
  targetPrice: number
  createdAt: string | null
}

interface SendTransactionRequest {
  fromAddress: string
  toAddress: string
  amount: string
  tokenAddress: string
  tokenSymbol: string
  chainId: number
}

interface WebappUserPreferences {
  defaultSlippage: number
  notificationsEnabled: boolean
  twoFaEnabled: boolean
  twoFaThreshold: number
}

interface WebappUserPreferencesResponse {
  user: {
    id: number
    telegramId?: number
    username?: string
    firstName?: string
    lastName?: string
  }
  preferences: WebappUserPreferences
  wallets: {
    address: string
    name: string
    chainType: 'evm' | 'solana'
    provider: 'local' | 'turnkey' | 'external'
    isDefault: boolean
    linkedAt: string
  }[]
}

interface WebappUpdatePreferencesResponse {
  success: boolean
  preferences: WebappUserPreferences
}

// Copy Trading types
interface CopyTraderEntry {
  rank: number
  userId: number
  displayName: string
  avatarEmoji: string
  totalTrades: number
  winRate: number
  totalPnlUsd: number
  totalVolumeUsd: number
  followerCount: number
  timesCopied: number
  rankScore: number
}

interface CopyTraderProfile {
  profile: {
    userId: number
    displayName: string | null
    avatarEmoji: string | null
    bio: string | null
    isPublic: boolean | null
  }
  stats: {
    totalTrades: number | null
    winningTrades: number | null
    winRate: number | null
    totalPnlUsd: number | null
    totalVolumeUsd: number | null
    avgTradeSizeUsd: number | null
    bestTradePnlUsd: number | null
    worstTradePnlUsd: number | null
  }
  social: {
    followerCount: number | null
    timesCopied: number | null
    totalCopyVolumeUsd: number | null
  }
  recentTrades: {
    fromToken: string
    toToken: string
    fromChain: string
    amountUsd: number
    pnlUsd: number | null
    createdAt: string | null
  }[]
}

interface CopyFollowingEntry {
  traderId: number
  displayName: string | null
  avatarEmoji: string | null
  copyMode: string | null
  copyAmountUsd: number | null
  autoSellEnabled: boolean | null
  chainsFilter: string | null
  totalCopiedTrades: number | null
  totalCopyPnl: number | null
  winRate: number | null
  isActive: boolean | null
}

interface CopyTradeRecord {
  id: number
  traderId: number
  fromToken: string
  toToken: string
  fromChain: string
  toChain: string
  traderAmountUsd: number
  copyAmountUsd: number
  status: string | null
  pnlUsd: number | null
  createdAt: string | null
}

// Token Discovery types
interface DexScreenerPair {
  chainId: string
  dexId: string
  pairAddress: string
  baseToken: { address: string; name: string; symbol: string }
  quoteToken: { address: string; name: string; symbol: string }
  priceUsd: string
  priceChange: { h24: number; h6?: number; h1?: number }
  volume: { h24: number; h6?: number; h1?: number }
  liquidity: { usd: number }
  marketCap?: number
  fdv?: number
}

interface TokenInfoResponse {
  pairs: DexScreenerPair[]
}

interface TokenChartResponse {
  candles: Array<{ time: number; open: number; high: number; low: number; close: number }>
}

interface TrendingToken {
  url: string
  chainId: string
  tokenAddress: string
  icon?: string
  name?: string
  symbol?: string
  price?: number
  priceChange24h?: number
  sparkline?: Array<{ time: number; value: number }>
}

interface CopyFollowSettings {
  copyMode?: string
  copyAmountUsd?: number
  maxTradeUsd?: number
  dailyLimitUsd?: number
  autoSellEnabled?: boolean
  chainsFilter?: string | null
}

// Export singleton instance
export const api = new WebappApiClient(API_BASE)

// Export for testing with different base URLs
export { WebappApiClient }

// Export types for components
export type {
  PointsStats,
  CheckinResult,
  WebappPointTransaction,
  WebappLeaderboardEntry,
  WebappReward,
  RedemptionResult,
  WebappLimitOrder,
  CreateLimitOrderRequest,
  CreateLimitOrderResult,
  SwapToken,
  CopyTraderEntry,
  CopyTraderProfile,
  CopyFollowingEntry,
  CopyTradeRecord,
  CopyFollowSettings,
  DexScreenerPair,
  TokenInfoResponse,
  TokenChartResponse,
  TrendingToken,
}
