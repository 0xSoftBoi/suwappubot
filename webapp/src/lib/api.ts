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
   * Get available tokens for swapping
   * TODO: Replace mock with real API
   */
  async getTokens(_chain?: string, _includeBalances = true): Promise<SwapToken[]> {
    // Mock data - replace with real API call
    await new Promise(resolve => setTimeout(resolve, 300))
    return mockTokens
  }

  /**
   * Get swap quote
   * TODO: Replace mock with real API
   */
  async getSwapQuote(request: SwapQuoteRequest): Promise<SwapQuote> {
    // Mock data - replace with real API call
    await new Promise(resolve => setTimeout(resolve, 800))
    
    const fromToken = mockTokens.find(t => t.address === request.fromToken)
    const toToken = mockTokens.find(t => t.address === request.toToken)
    
    if (!fromToken || !toToken) {
      throw { detail: 'Token not found', status: 404 }
    }

    const amount = parseFloat(request.amount)
    // Mock exchange rate based on token "prices"
    const fromPrice = mockPrices[fromToken.symbol] || 1
    const toPrice = mockPrices[toToken.symbol] || 1
    const rate = fromPrice / toPrice
    const toAmount = amount * rate
    const slippage = request.slippage || 0.5

    return {
      id: `quote-${Date.now()}`,
      fromToken,
      toToken,
      fromAmount: request.amount,
      toAmount: toAmount.toFixed(6),
      fromAmountUsd: amount * fromPrice,
      toAmountUsd: toAmount * toPrice,
      exchangeRate: rate,
      priceImpact: 0.05,
      estimatedGas: '0.002',
      gasUsd: 3.50,
      route: 'Via Uniswap → 1inch',
      expiresAt: new Date(Date.now() + 60000).toISOString(),
      minReceived: (toAmount * (1 - slippage / 100)).toFixed(6),
      slippage,
    }
  }

  /**
   * Execute a swap
   * TODO: Replace mock with real API
   */
  async executeSwap(_request: SwapExecuteRequest): Promise<SwapExecuteResult> {
    // Mock execution - replace with real API call
    await new Promise(resolve => setTimeout(resolve, 2000))
    
    return {
      swapId: `swap-${Date.now()}`,
      txHash: `0x${Math.random().toString(16).slice(2)}${Math.random().toString(16).slice(2)}`,
      status: 'submitted',
    }
  }
}

// Export singleton instance
export const api = new ApiClient(API_BASE)

// Export for testing with different base URLs
export { ApiClient }

// === Mock Data (TODO: Remove when real API is ready) ===

const mockPrices: Record<string, number> = {
  ETH: 1850,
  WETH: 1850,
  USDC: 1,
  USDT: 1,
  DAI: 1,
  WBTC: 43000,
  ARB: 1.15,
  OP: 2.30,
  MATIC: 0.85,
}

const mockTokens: SwapToken[] = [
  {
    symbol: 'ETH',
    name: 'Ethereum',
    address: '0x0000000000000000000000000000000000000000',
    chain: 'ethereum',
    decimals: 18,
    logoUrl: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/info/logo.png',
    balance: '0.5432',
    balanceUsd: 1004.92,
  },
  {
    symbol: 'USDC',
    name: 'USD Coin',
    address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
    chain: 'ethereum',
    decimals: 6,
    logoUrl: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48/logo.png',
    balance: '1250.00',
    balanceUsd: 1250.00,
  },
  {
    symbol: 'USDT',
    name: 'Tether USD',
    address: '0xdac17f958d2ee523a2206206994597c13d831ec7',
    chain: 'ethereum',
    decimals: 6,
    logoUrl: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xdAC17F958D2ee523a2206206994597C13D831ec7/logo.png',
    balance: '500.00',
    balanceUsd: 500.00,
  },
  {
    symbol: 'WBTC',
    name: 'Wrapped Bitcoin',
    address: '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599',
    chain: 'ethereum',
    decimals: 8,
    logoUrl: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599/logo.png',
    balance: '0.0125',
    balanceUsd: 537.50,
  },
  {
    symbol: 'DAI',
    name: 'Dai Stablecoin',
    address: '0x6b175474e89094c44da98b954eedeac495271d0f',
    chain: 'ethereum',
    decimals: 18,
    logoUrl: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0x6B175474E89094C44Da98b954EesdeAC495271d0F/logo.png',
    balance: '0',
    balanceUsd: 0,
  },
  {
    symbol: 'ARB',
    name: 'Arbitrum',
    address: '0x912ce59144191c1204e64559fe8253a0e49e6548',
    chain: 'arbitrum',
    decimals: 18,
    logoUrl: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/arbitrum/info/logo.png',
    balance: '100.00',
    balanceUsd: 115.00,
  },
  {
    symbol: 'OP',
    name: 'Optimism',
    address: '0x4200000000000000000000000000000000000042',
    chain: 'optimism',
    decimals: 18,
    logoUrl: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/optimism/info/logo.png',
    balance: '50.00',
    balanceUsd: 115.00,
  },
  {
    symbol: 'MATIC',
    name: 'Polygon',
    address: '0x0000000000000000000000000000000000001010',
    chain: 'polygon',
    decimals: 18,
    logoUrl: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/polygon/info/logo.png',
    balance: '200.00',
    balanceUsd: 170.00,
  },
]
