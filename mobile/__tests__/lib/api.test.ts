/**
 * Tests for the mobile API client.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals'

// Mock fetch globally
const mockFetch = jest.fn() as jest.MockedFunction<typeof fetch>
global.fetch = mockFetch

// Mock the auth module
jest.mock('../../lib/auth', () => ({
  getAuthToken: jest.fn().mockReturnValue('test-jwt-token'),
}))

// Mock authEvents
jest.mock('../../lib/authEvents', () => ({
  authEvents: { emit: jest.fn() },
}))

// Import the singleton — only `api` is exported, not the class
const { api } = require('../../lib/api')

describe('MobileApiClient', () => {
  beforeEach(() => {
    mockFetch.mockReset()
  })

  describe('sendTokens', () => {
    it('sends POST request with correct params', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ txHash: '0xabc123', status: 'pending' }),
      } as Response)

      const result = await api.sendTokens({
        recipient: '0x1234567890abcdef1234567890abcdef12345678',
        token: 'ETH',
        amount: 1.5,
        chain: 'ethereum',
      })

      expect(result.txHash).toBe('0xabc123')
      expect(mockFetch).toHaveBeenCalledTimes(1)
      const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit]
      expect(url).toContain('/v1/wallet/send')
      expect(options.method).toBe('POST')
    })
  })

  describe('getDiscoverTrending', () => {
    it('fetches trending tokens', async () => {
      const mockTokens = [
        { symbol: 'BONK', price: 0.00001, change24h: 15.5 },
        { symbol: 'WIF', price: 0.5, change24h: -3.2 },
      ]
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockTokens,
      } as Response)

      const result = await api.getDiscoverTrending('solana', 10)

      expect(result).toHaveLength(2)
      expect(result[0].symbol).toBe('BONK')
    })
  })

  describe('getPortfolio', () => {
    it('fetches user portfolio', async () => {
      const mockPortfolio = {
        totalValue: 1500.0,
        tokens: [{ symbol: 'ETH', balance: '0.5', usdValue: 1400 }],
      }
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockPortfolio,
      } as Response)

      const result = await api.getPortfolio()

      expect(result.totalValue).toBe(1500.0)
      expect(result.tokens).toHaveLength(1)
    })
  })

  describe('error handling', () => {
    it('handles 401 unauthorized', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({ error: 'Unauthorized' }),
      } as Response)

      await expect(api.getPortfolio()).rejects.toThrow()
    })

    it('handles network errors', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'))

      await expect(api.getPortfolio()).rejects.toThrow('Network error')
    })
  })
})
