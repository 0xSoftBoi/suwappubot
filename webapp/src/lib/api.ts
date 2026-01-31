/**
 * API client for Suwappu backend
 *
 * Supports dual authentication:
 * - Telegram initData (primary for Mini App)
 * - JWT token (for Turnkey wallet auth)
 */
import { getInitData } from './telegram'
import { getAuthToken } from './auth'
import type { Portfolio, Swap, ApiError, HealthStatus, UserPreferencesResponse, UpdatePreferencesResponse, UserPreferences } from '../types/api'
import type { LinkedWallet, AuthChallenge, LinkWalletResponse } from '../types/auth'
import type { SwapToken, SwapQuote, SwapQuoteRequest, SwapExecuteRequest, SwapExecuteResult } from '../types/swap'

const API_BASE = import.meta.env.VITE_API_URL || ''

class ApiClient {
  private baseUrl: string

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl
  }

  /**
   * Build auth headers for requests.
   * Includes both Telegram initData and JWT if available.
   * Falls back to dev mode for browser testing.
   */
  private getAuthHeaders(): Record<string, string> {
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

    // Dev mode: ALWAYS add dev user header on dev API (as fallback for invalid/expired auth)
    const isDev = this.baseUrl.includes('devapi') || this.baseUrl.includes('localhost')
    if (isDev) {
      headers['X-Dev-User-Id'] = '12345'
    }

    return headers
  }

  private async fetch<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...this.getAuthHeaders(),
      ...(options.headers as Record<string, string>),
    }

    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      ...options,
      headers,
    })

    if (!response.ok) {
      const error: ApiError = {
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

  // === Wallet ===

  /**
   * Get or create wallet for authenticated user
   */
  async getOrCreateWallet(): Promise<{ address: string; chain: string }> {
    return this.fetch('/webapp/wallets/default', { method: 'POST' })
  }

  // === Portfolio & Swaps ===

  /**
   * Get current user's portfolio
   */
  async getPortfolio(): Promise<Portfolio> {
    return this.fetch<Portfolio>('/webapp/users/me/portfolio')
  }

  /**
   * Get current user's swap history
   */
  async getSwaps(limit = 20, offset = 0): Promise<Swap[]> {
    return this.fetch<Swap[]>(`/webapp/users/me/swaps?limit=${limit}&offset=${offset}`)
  }

  /**
   * Get a specific swap by ID
   */
  async getSwap(id: string): Promise<Swap> {
    return this.fetch<Swap>(`/swaps/${id}`)
  }

  // === Auth ===

  /**
   * Validate Telegram init data (for testing auth)
   */
  async validateAuth(): Promise<{ valid: boolean; user?: unknown }> {
    return this.fetch('/webapp/validate', { method: 'POST' })
  }

  // === Health ===

  /**
   * Check API health status
   */
  async getHealth(): Promise<HealthStatus> {
    return this.fetch<HealthStatus>('/health')
  }

  // === Wallet Linking ===

  /**
   * Request a challenge for wallet linking
   */
  async requestWalletChallenge(address: string): Promise<AuthChallenge> {
    return this.fetch<AuthChallenge>('/webapp/challenge', {
      method: 'POST',
      body: JSON.stringify({ address }),
    })
  }

  /**
   * Link a wallet to the current Telegram user
   */
  async linkWallet(address: string, signature: string, nonce: string): Promise<LinkWalletResponse> {
    return this.fetch<LinkWalletResponse>('/webapp/link-wallet', {
      method: 'POST',
      body: JSON.stringify({ address, signature, nonce }),
    })
  }

  /**
   * Get all wallets linked to the current user
   */
  async getLinkedWallets(): Promise<LinkedWallet[]> {
    return this.fetch<LinkedWallet[]>('/webapp/users/me/wallets')
  }

  /**
   * Unlink a wallet from the current user
   */
  async unlinkWallet(address: string): Promise<{ success: boolean; message: string }> {
    return this.fetch(`/webapp/wallets/${encodeURIComponent(address)}`, {
      method: 'DELETE',
    })
  }

  // === Tokens & Swap ===

  /**
   * Get available tokens for swapping (PUBLIC API - no auth needed)
   */
  async getTokens(chainId = '1', _includeBalances = true): Promise<SwapToken[]> {
    // Use public /tokens endpoint (no auth required)
    // Note: _includeBalances reserved for future wallet balance integration
    const response = await fetch(`${this.baseUrl}/tokens?chainId=${chainId}`)
    if (!response.ok) throw new Error('Failed to fetch tokens')
    const data = await response.json()
    
    return data.tokens.map((t: any) => ({
      symbol: t.symbol,
      name: t.name,
      address: t.address,
      chain: chainId,
      decimals: t.decimals,
      logoUrl: t.logoURI || t.logoUrl, // Support both Li.Fi (logoURI) and other APIs (logoUrl)
    }))
  }

  /**
   * Get chains list (PUBLIC API - no auth needed)
   */
  async getChains(): Promise<{ id: number, key: string, name: string }[]> {
    const response = await fetch(`${this.baseUrl}/chains`)
    if (!response.ok) throw new Error('Failed to fetch chains')
    const data = await response.json()
    return data.chains
  }

  /**
   * Get swap quote (REAL API)
   */
  async getSwapQuote(request: SwapQuoteRequest): Promise<SwapQuote> {
    const params = new URLSearchParams({
      fromChain: request.fromChain,
      toChain: request.toChain,
      fromToken: request.fromToken,
      toToken: request.toToken,
      fromAmount: request.amount,
    })
    if (request.slippage) params.set('slippage', String(request.slippage / 100))
    
    return this.fetch<SwapQuote>(`/webapp/swap/quote?${params}`)
  }

  /**
   * Execute a swap (REAL API)
   */
  async executeSwap(request: SwapExecuteRequest): Promise<SwapExecuteResult> {
    return this.fetch<SwapExecuteResult>('/webapp/swap/execute', {
      method: 'POST',
      body: JSON.stringify(request),
    })
  }

  // === User Preferences ===

  /**
   * Get user preferences (settings page data)
   */
  async getUserPreferences(): Promise<UserPreferencesResponse> {
    return this.fetch<UserPreferencesResponse>('/webapp/me/preferences')
  }

  /**
   * Update user preferences
   */
  async updateUserPreferences(preferences: Partial<UserPreferences>): Promise<UpdatePreferencesResponse> {
    return this.fetch<UpdatePreferencesResponse>('/webapp/me/preferences', {
      method: 'PUT',
      body: JSON.stringify(preferences),
    })
  }

  // === Points & Rewards ===

  /**
   * Get user's points stats
   */
  async getPointsStats(): Promise<PointsStats> {
    return this.fetch<PointsStats>('/webapp/me/points/stats')
  }

  /**
   * Daily check-in
   */
  async dailyCheckin(): Promise<CheckinResult> {
    return this.fetch<CheckinResult>('/webapp/me/points/checkin', { method: 'POST' })
  }

  /**
   * Get points transaction history
   */
  async getPointsHistory(limit = 20, offset = 0): Promise<PointTransaction[]> {
    return this.fetch<PointTransaction[]>(`/webapp/me/points/history?limit=${limit}&offset=${offset}`)
  }

  /**
   * Get leaderboard
   */
  async getLeaderboard(limit = 10): Promise<LeaderboardEntry[]> {
    return this.fetch<LeaderboardEntry[]>(`/webapp/me/points/leaderboard?limit=${limit}`)
  }

  /**
   * Get available rewards
   */
  async getRewards(): Promise<Reward[]> {
    return this.fetch<Reward[]>('/webapp/me/points/rewards')
  }

  /**
   * Redeem a reward
   */
  async redeemReward(rewardId: number): Promise<RedemptionResult> {
    return this.fetch<RedemptionResult>(`/webapp/me/points/redeem/${rewardId}`, { method: 'POST' })
  }
}

// Points types
export interface PointsStats {
  totalPoints: number
  currentStreak: number
  longestStreak: number
  lastCheckin: string | null
  canCheckin: boolean
  rank?: number
}

export interface CheckinResult {
  success: boolean
  pointsAwarded: number
  newTotal: number
  streak: number
  bonusPoints?: number
}

export interface PointTransaction {
  id: number
  amount: number
  action: string
  description: string | null
  createdAt: string
}

export interface LeaderboardEntry {
  rank: number
  userId: number
  username: string | null
  firstName: string | null
  totalPoints: number
  currentStreak: number
}

export interface Reward {
  id: number
  name: string
  description: string
  emoji: string
  pointsCost: number
  rewardType: string
  rewardValue: string | null
  stock: number | null
}

export interface RedemptionResult {
  id: number
  pointsSpent: number
  rewardType: string
  rewardValue: string | null
  status: string
  expiresAt: string | null
}

// Export singleton instance
export const api = new ApiClient(API_BASE)

// Export for testing with different base URLs
export { ApiClient }

