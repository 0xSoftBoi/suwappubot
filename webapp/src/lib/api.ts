/**
 * API client for Suwappu backend
 */
import { getInitData } from './telegram'
import type { Portfolio, Swap, ApiError } from '../types/api'

const API_BASE = import.meta.env.VITE_API_URL || ''

class ApiClient {
  private baseUrl: string

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl
  }

  private async fetch<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const initData = getInitData()

    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      ...options.headers,
    }

    // Add Telegram auth header if available
    if (initData) {
      headers['X-Telegram-Init-Data'] = initData
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

  /**
   * Get current user's portfolio
   */
  async getPortfolio(): Promise<Portfolio> {
    return this.fetch<Portfolio>('/users/me/portfolio')
  }

  /**
   * Get current user's swap history
   */
  async getSwaps(limit = 20, offset = 0): Promise<Swap[]> {
    return this.fetch<Swap[]>(`/users/me/swaps?limit=${limit}&offset=${offset}`)
  }

  /**
   * Get a specific swap by ID
   */
  async getSwap(id: string): Promise<Swap> {
    return this.fetch<Swap>(`/swaps/${id}`)
  }

  /**
   * Validate Telegram init data (for testing auth)
   */
  async validateAuth(): Promise<{ valid: boolean; user?: unknown }> {
    return this.fetch('/webapp/validate', { method: 'POST' })
  }
}

// Export singleton instance
export const api = new ApiClient(API_BASE)

// Export for testing with different base URLs
export { ApiClient }
