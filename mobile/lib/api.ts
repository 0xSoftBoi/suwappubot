/**
 * API client for Suwappu mobile app
 *
 * Extends the shared BaseApiClient with mobile-specific auth:
 * - Expo SecureStore for token storage
 * - JWT bearer token authentication
 */
import { BaseApiClient } from '@suwappu/shared'
import * as SecureStore from 'expo-secure-store'

const API_BASE = process.env.EXPO_PUBLIC_API_URL || 'https://api.suwappu.bot'
const AUTH_TOKEN_KEY = 'suwappu_auth_token'

class MobileApiClient extends BaseApiClient {
  private cachedToken: string | null = null

  /**
   * Get auth headers with JWT token from SecureStore
   */
  protected getAuthHeaders(): Record<string, string> {
    // Use cached token if available (SecureStore is sync but can be slow)
    const token = this.cachedToken || SecureStore.getItem(AUTH_TOKEN_KEY)
    if (token) {
      this.cachedToken = token
      return { Authorization: `Bearer ${token}` }
    }
    return {}
  }

  /**
   * Store authentication token securely
   */
  async setAuthToken(token: string): Promise<void> {
    await SecureStore.setItemAsync(AUTH_TOKEN_KEY, token)
    this.cachedToken = token
  }

  /**
   * Clear authentication token
   */
  async clearAuthToken(): Promise<void> {
    await SecureStore.deleteItemAsync(AUTH_TOKEN_KEY)
    this.cachedToken = null
  }

  /**
   * Check if user has a stored token
   */
  hasAuthToken(): boolean {
    return this.cachedToken !== null || SecureStore.getItem(AUTH_TOKEN_KEY) !== null
  }

  // === Mobile-specific methods ===

  /**
   * Toggle an alert's active status
   */
  async toggleAlert(id: number): Promise<{ success: boolean }> {
    return this.fetch(`/v1/alerts/${id}/toggle`, { method: 'PUT' })
  }

  /**
   * Register push notification token with backend
   */
  async registerPushToken(token: string): Promise<{ success: boolean }> {
    return this.fetch('/v1/me/push-token', {
      method: 'POST',
      body: JSON.stringify({ token, platform: 'expo' }),
    })
  }

  /**
   * Unregister push notification token
   */
  async unregisterPushToken(): Promise<{ success: boolean }> {
    return this.fetch('/v1/me/push-token', { method: 'DELETE' })
  }

  // === Wallet operations ===

  /**
   * Create a new wallet for a specific chain type
   */
  async createWallet(chainType: string): Promise<{ address: string; chain: string }> {
    return this.fetch('/v1/wallets', {
      method: 'POST',
      body: JSON.stringify({ chainType }),
    })
  }

  /**
   * Set a wallet as the default
   */
  async setDefaultWallet(address: string): Promise<{ success: boolean }> {
    return this.fetch(`/v1/wallets/${encodeURIComponent(address)}/default`, {
      method: 'PUT',
    })
  }

  // === Token discovery ===

  /**
   * Get trending tokens
   */
  async getDiscoverTrending(chain: string, limit: number): Promise<DiscoveryToken[]> {
    const params = new URLSearchParams({ chain, limit: String(limit) })
    return this.fetch(`/v1/discover/trending?${params}`)
  }

  /**
   * Get top gainers
   */
  async getDiscoverGainers(timeframe: string): Promise<DiscoveryToken[]> {
    return this.fetch(`/v1/discover/gainers?timeframe=${timeframe}`)
  }

  /**
   * Get newly listed tokens
   */
  async getDiscoverNew(chain: string): Promise<DiscoveryToken[]> {
    return this.fetch(`/v1/discover/new?chain=${chain}`)
  }

  /**
   * Search tokens
   */
  async getDiscoverSearch(query: string): Promise<DiscoveryToken[]> {
    return this.fetch(`/v1/discover/search?q=${encodeURIComponent(query)}`)
  }

  // === Token price data ===

  /**
   * Get token price with OHLCV data
   */
  async getTokenPrice(chain: string, address: string, timeframe: string): Promise<TokenPriceData> {
    return this.fetch(`/v1/tokens/${chain}/${address}/price?timeframe=${timeframe}`)
  }
}

// Types for mobile-specific endpoints
interface DiscoveryToken {
  address: string
  symbol: string
  name: string
  chain: string
  price: number
  change24h: number
  volume24h: number
  marketCap: number | null
  logoUrl: string | null
}

interface TokenPriceData {
  price: number
  change24h: number
  changePercent24h: number
  marketCap: number | null
  volume24h: number | null
  liquidity: number | null
  holders: number | null
  symbol: string
  name: string
  logoUrl: string | null
  prices: Array<{ timestamp: number; value: number }>
}

// Export singleton instance
export const api = new MobileApiClient(API_BASE)

// Export class for testing
export { MobileApiClient }

// Re-export all types from shared package for convenience
export * from '@suwappu/shared'
