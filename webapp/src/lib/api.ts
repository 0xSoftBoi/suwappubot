/**
 * API client for Suwappu backend
 *
 * Supports dual authentication:
 * - Telegram initData (primary for Mini App)
 * - JWT token (for Turnkey wallet auth)
 */
import { getInitData } from './telegram'
import { getAuthToken } from './auth'
import type { Portfolio, Swap, ApiError, HealthStatus } from '../types/api'
import type { LinkedWallet, AuthChallenge, LinkWalletResponse } from '../types/auth'

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

  // === Quotes & Swaps ===

  /**
   * Get a swap quote from Li.Fi
   */
  async getQuote(params: {
    fromChain: string
    toChain: string
    fromToken: string
    toToken: string
    fromAmount: string
    slippage?: number
  }): Promise<QuoteResponse> {
    const searchParams = new URLSearchParams({
      fromChain: params.fromChain,
      toChain: params.toChain,
      fromToken: params.fromToken,
      toToken: params.toToken,
      fromAmount: params.fromAmount,
    })
    if (params.slippage) {
      searchParams.set('slippage', params.slippage.toString())
    }
    return this.fetch<QuoteResponse>(`/webapp/quote?${searchParams}`)
  }

  /**
   * Get supported tokens for a chain
   */
  async getTokens(chain?: string): Promise<TokenListResponse> {
    const url = chain ? `/webapp/tokens?chain=${chain}` : '/webapp/tokens'
    return this.fetch<TokenListResponse>(url)
  }
}

// Quote response type
export interface QuoteResponse {
  id: string
  fromChain: string
  toChain: string
  fromToken: {
    symbol: string
    address: string
    decimals: number
    priceUSD: string
  }
  toToken: {
    symbol: string
    address: string
    decimals: number
    priceUSD: string
  }
  fromAmount: string
  toAmount: string
  toAmountMin: string
  fromAmountUSD: string
  toAmountUSD: string
  route: {
    steps: number
    protocol: string
    bridgeUsed?: string
  }
  estimatedGas: string
  estimatedGasUSD: string
  executionDuration: number
  priceImpact: string
}

// Token list response
export interface TokenListResponse {
  chain?: string
  chains?: string[]
  tokens: Array<{
    symbol: string
    name: string
    decimals: number
  }> | Record<string, Array<{
    symbol: string
    name: string
    decimals: number
  }>>
}

// Export singleton instance
export const api = new ApiClient(API_BASE)

// Export for testing with different base URLs
export { ApiClient }
