/**
 * Integration tests for Suwappu API
 * These tests hit the real dev API endpoints
 */
import { describe, it, expect, beforeAll } from 'bun:test'

const API_URL = process.env.API_URL || 'https://devapi.suwappu.bot'

describe('API Integration Tests', () => {
  describe('Health Check', () => {
    it('should return healthy status', async () => {
      const response = await fetch(`${API_URL}/health`)
      expect(response.ok).toBe(true)
      
      const data = await response.json()
      expect(data.status).toBe('ok')
      expect(data.service).toBe('suwappu-api-ts')
      expect(data.version).toBeDefined()
    })
  })

  describe('Chains Endpoint', () => {
    it('should return list of supported chains', async () => {
      const response = await fetch(`${API_URL}/chains`)
      expect(response.ok).toBe(true)
      
      const data = await response.json()
      expect(data.chains).toBeDefined()
      expect(Array.isArray(data.chains)).toBe(true)
      expect(data.chains.length).toBeGreaterThan(0)
      
      // Verify chain structure
      const ethereum = data.chains.find((c: any) => c.key === 'ethereum')
      expect(ethereum).toBeDefined()
      expect(ethereum.id).toBe(1)
      expect(ethereum.name).toBe('Ethereum')
    })

    it('should include multiple chains', async () => {
      const response = await fetch(`${API_URL}/chains`)
      const data = await response.json()
      
      // Should have at least 5 chains (Ethereum, Polygon, BSC, Arbitrum, Optimism, etc)
      expect(data.chains.length).toBeGreaterThanOrEqual(5)
    })
  })

  describe('Tokens Endpoint', () => {
    it('should return tokens for Ethereum', async () => {
      const response = await fetch(`${API_URL}/tokens?chainId=1`)
      expect(response.ok).toBe(true)
      
      const data = await response.json()
      expect(data.tokens).toBeDefined()
      expect(Array.isArray(data.tokens)).toBe(true)
      expect(data.tokens.length).toBeGreaterThan(0)
      
      // Verify token structure
      const token = data.tokens[0]
      expect(token.symbol).toBeDefined()
      expect(token.name).toBeDefined()
      expect(token.address).toBeDefined()
      expect(token.decimals).toBeDefined()
    })

    it('should include common tokens', async () => {
      const response = await fetch(`${API_URL}/tokens?chainId=1`)
      const data = await response.json()
      
      const symbols = data.tokens.map((t: any) => t.symbol.toUpperCase())
      expect(symbols).toContain('ETH')
      expect(symbols).toContain('USDC')
    })
  })

  describe('Agent Card Endpoint', () => {
    it('should return valid A2A agent card (if available)', async () => {
      const response = await fetch(`${API_URL}/agent-card.json`)
      
      // Agent card may not be deployed yet
      if (response.ok) {
        const data = await response.json()
        expect(data.name).toBe('Suwappu')
        expect(data.description).toBeDefined()
        expect(data.url).toBeDefined()
      } else {
        // Accept 404 if not deployed
        expect([404, 401]).toContain(response.status)
      }
    })
  })

  describe('Protected Endpoints (should require auth)', () => {
    it('should reject portfolio request without auth', async () => {
      const response = await fetch(`${API_URL}/webapp/users/me/portfolio`)
      expect(response.status).toBe(401)
      
      const data = await response.json()
      expect(data.error || data.message).toBeDefined()
    })

    it('should reject swaps request without auth', async () => {
      const response = await fetch(`${API_URL}/webapp/users/me/swaps`)
      expect(response.status).toBe(401)
    })

    it('should reject preferences request without auth', async () => {
      const response = await fetch(`${API_URL}/webapp/me/preferences`)
      expect(response.status).toBe(401)
    })

    it('should reject points request without auth', async () => {
      const response = await fetch(`${API_URL}/webapp/me/points/stats`)
      expect(response.status).toBe(401)
    })
  })

  describe('Swap Quote Endpoint', () => {
    it('should require authentication for quotes', async () => {
      const params = new URLSearchParams({
        fromChain: 'ethereum',
        toChain: 'ethereum',
        fromToken: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
        toToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        fromAmount: '1000000000000000000',
      })
      
      const response = await fetch(`${API_URL}/webapp/swap/quote?${params}`)
      expect(response.status).toBe(401)
    })
  })
})
