import { describe, it, expect, beforeEach, mock } from 'bun:test'
import { ApiClient } from './api'

// Mock fetch globally
const mockFetch = mock(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }))

// @ts-ignore
globalThis.fetch = mockFetch

describe('ApiClient', () => {
  let api: ApiClient

  beforeEach(() => {
    api = new ApiClient('https://api.test.com')
    mockFetch.mockReset()
  })

  describe('getHealth', () => {
    it('should return health status', async () => {
      const mockResponse = {
        status: 'ok',
        service: 'suwappu-api-ts',
        version: '0.3.0',
      }

      mockFetch.mockImplementationOnce(() => Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      }))

      const result = await api.getHealth()
      expect(result).toEqual(mockResponse)
    })
  })

  describe('getChains', () => {
    it('should return list of chains', async () => {
      const mockChains = {
        chains: [
          { id: 1, key: 'ethereum', name: 'Ethereum' },
          { id: 137, key: 'polygon', name: 'Polygon' },
        ],
      }

      mockFetch.mockImplementationOnce(() => Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mockChains),
      }))

      const result = await api.getChains()
      expect(result).toEqual(mockChains.chains)
    })
  })

  describe('getTokens', () => {
    it('should return tokens for chain', async () => {
      const mockTokens = {
        tokens: [
          { symbol: 'ETH', name: 'Ethereum', address: '0x0', decimals: 18 },
          { symbol: 'USDC', name: 'USD Coin', address: '0x1', decimals: 6 },
        ],
      }

      mockFetch.mockImplementationOnce(() => Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mockTokens),
      }))

      const result = await api.getTokens('1')
      expect(result).toHaveLength(2)
      expect(result[0].symbol).toBe('ETH')
    })
  })

  describe('error handling', () => {
    it('should throw error on failed request', async () => {
      mockFetch.mockImplementationOnce(() => Promise.resolve({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ detail: 'Unauthorized' }),
      }))

      try {
        await api.getPortfolio()
        expect(true).toBe(false) // Should not reach
      } catch (e: any) {
        expect(e.detail).toBe('Unauthorized')
        expect(e.status).toBe(401)
      }
    })

    it('should handle network errors', async () => {
      mockFetch.mockImplementationOnce(() => Promise.reject(new Error('Network error')))

      try {
        await api.getHealth()
        expect(true).toBe(false) // Should not reach
      } catch (e: any) {
        expect(e.message).toBe('Network error')
      }
    })
  })
})
