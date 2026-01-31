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
}

// Export singleton instance
export const api = new ApiClient(API_BASE)

// Export for testing with different base URLs
export { ApiClient }

