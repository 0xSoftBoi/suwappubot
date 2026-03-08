import { describe, it, expect, beforeEach, mock, spyOn } from 'bun:test'
import { WebappApiClient } from './api'

// Mock the telegram and auth modules
import * as telegram from './telegram'
import * as auth from './auth'

// Provide localStorage for auth module
if (typeof globalThis.localStorage === 'undefined') {
  const store: Record<string, string> = {}
  // @ts-ignore
  globalThis.localStorage = {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value },
    removeItem: (key: string) => { delete store[key] },
    clear: () => { Object.keys(store).forEach(k => delete store[k]) },
  }
}

// Mock fetch globally
const mockFetch = mock(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }))

// @ts-ignore
globalThis.fetch = mockFetch

describe('WebappApiClient', () => {
  let api: WebappApiClient

  beforeEach(() => {
    api = new WebappApiClient('https://api.test.com')
    mockFetch.mockReset()
    mockFetch.mockImplementation(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }))
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

    it('fetch error returns error with status and detail', async () => {
      mockFetch.mockImplementationOnce(() => Promise.resolve({
        ok: false,
        status: 403,
        json: () => Promise.resolve({ detail: 'Forbidden resource' }),
      }))

      try {
        await api.getHealth()
        expect(true).toBe(false) // Should not reach
      } catch (e: any) {
        expect(e.status).toBe(403)
        expect(e.detail).toBe('Forbidden resource')
      }
    })
  })

  describe('getAuthHeaders', () => {
    it('includes X-Telegram-Init-Data when available', async () => {
      const spy = spyOn(telegram, 'getInitData').mockReturnValue('telegram-init-data-abc')
      spyOn(auth, 'getAuthToken').mockReturnValue(null)

      mockFetch.mockImplementationOnce(() => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
      }))

      await api.getHealth()

      const callArgs = mockFetch.mock.calls[0]
      const headers = (callArgs as any)[1]?.headers || {}
      expect(headers['X-Telegram-Init-Data']).toBe('telegram-init-data-abc')

      spy.mockRestore()
    })

    it('includes Authorization Bearer when JWT set', async () => {
      spyOn(telegram, 'getInitData').mockReturnValue('')
      const spy = spyOn(auth, 'getAuthToken').mockReturnValue('jwt-token-xyz')

      mockFetch.mockImplementationOnce(() => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
      }))

      await api.getHealth()

      const callArgs = mockFetch.mock.calls[0]
      const headers = (callArgs as any)[1]?.headers || {}
      expect(headers['Authorization']).toBe('Bearer jwt-token-xyz')

      spy.mockRestore()
    })
  })

  describe('getPortfolio', () => {
    it('calls /webapp/users/me/portfolio', async () => {
      const mockPortfolio = { totalValue: '1000', tokens: [] }

      mockFetch.mockImplementationOnce(() => Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mockPortfolio),
      }))

      const result = await api.getPortfolio()

      const callArgs = mockFetch.mock.calls[0]
      const url = (callArgs as any)[0] as string
      expect(url).toBe('https://api.test.com/webapp/users/me/portfolio')
      expect(result).toEqual(mockPortfolio)
    })
  })

  describe('getSwaps', () => {
    it('passes limit and offset query params', async () => {
      const mockSwaps = [{ id: '1', status: 'completed' }]

      mockFetch.mockImplementationOnce(() => Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mockSwaps),
      }))

      await api.getSwaps(10, 5)

      const callArgs = mockFetch.mock.calls[0]
      const url = (callArgs as any)[0] as string
      expect(url).toBe('https://api.test.com/webapp/users/me/swaps?limit=10&offset=5')
    })
  })

  describe('getSwapQuote', () => {
    it('constructs correct query string', async () => {
      const mockQuote = { fromAmount: '1', toAmount: '2000' }

      mockFetch.mockImplementationOnce(() => Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mockQuote),
      }))

      await api.getSwapQuote({
        fromChain: 'ethereum',
        toChain: 'polygon',
        fromToken: '0xabc',
        toToken: '0xdef',
        amount: '1.5',
      })

      const callArgs = mockFetch.mock.calls[0]
      const url = (callArgs as any)[0] as string
      expect(url).toContain('/webapp/swap/quote?')
      expect(url).toContain('fromChain=ethereum')
      expect(url).toContain('toChain=polygon')
      expect(url).toContain('fromToken=0xabc')
      expect(url).toContain('toToken=0xdef')
      expect(url).toContain('fromAmount=1.5')
    })
  })

  describe('executeSwap', () => {
    it('sends POST with JSON body', async () => {
      const mockResult = { txHash: '0x123', status: 'pending' }
      const request = {
        fromChain: 'ethereum',
        toChain: 'polygon',
        fromToken: '0xabc',
        toToken: '0xdef',
        amount: '1.5',
        walletAddress: '0xwallet',
        slippage: 0.5,
      }

      mockFetch.mockImplementationOnce(() => Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mockResult),
      }))

      const result = await api.executeSwap(request)

      const callArgs = mockFetch.mock.calls[0]
      const url = (callArgs as any)[0] as string
      const options = (callArgs as any)[1]
      expect(url).toBe('https://api.test.com/webapp/swap/execute')
      expect(options.method).toBe('POST')
      expect(JSON.parse(options.body)).toEqual(request)
      expect(result).toEqual(mockResult)
    })
  })
})
