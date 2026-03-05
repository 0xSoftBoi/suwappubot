/**
 * Mock API client for Storybook and testing
 *
 * Provides the same interface as the real API client
 * but returns mock data without making network requests.
 */
import type { Portfolio, Swap, HealthStatus } from '../types/api'
import type { LinkedWallet, AuthChallenge, LinkWalletResponse } from '../types/auth'
import { mockPortfolio, mockSwaps } from '../stories/mockData'

// Simulated network delay (ms)
const MOCK_DELAY = 300

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export const mockApi = {
  // === Portfolio & Swaps ===

  async getPortfolio(): Promise<Portfolio> {
    await delay(MOCK_DELAY)
    return {
      ...mockPortfolio,
      lastUpdated: new Date().toISOString(),
    }
  },

  async getSwaps(limit = 20, offset = 0): Promise<Swap[]> {
    await delay(MOCK_DELAY)
    return mockSwaps.slice(offset, offset + limit)
  },

  async getSwap(id: string): Promise<Swap> {
    await delay(MOCK_DELAY)
    const swap = mockSwaps.find((s) => s.id === id)
    if (!swap) {
      throw { detail: 'Swap not found', status: 404 }
    }
    return swap
  },

  // === Auth ===

  async validateAuth(): Promise<{ valid: boolean; user?: unknown }> {
    await delay(MOCK_DELAY)
    return {
      valid: true,
      user: {
        id: 123456789,
        first_name: 'Demo',
        username: 'demo_user',
      },
    }
  },

  // === Health ===

  async getHealth(): Promise<HealthStatus> {
    await delay(100) // Health checks should be fast
    return {
      status: 'ok',
      service: 'suwappu-api-ts (mock)',
      timestamp: new Date().toISOString(),
    }
  },

  // === Wallet Linking ===

  async requestWalletChallenge(address: string): Promise<AuthChallenge> {
    await delay(MOCK_DELAY)
    return {
      challenge: `Sign this message to link your wallet to Suwappu.\n\nAddress: ${address}\nNonce: mock-nonce-${Date.now()}`,
      nonce: 'mock-nonce-' + Date.now(),
      expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    }
  },

  async linkWallet(
    address: string,
    _signature: string,
    _nonce: string
  ): Promise<LinkWalletResponse> {
    await delay(MOCK_DELAY)
    return {
      success: true,
      walletAddress: address,
      message: 'Wallet linked successfully',
    }
  },

  async getLinkedWallets(): Promise<LinkedWallet[]> {
    await delay(MOCK_DELAY)
    return [
      {
        address: '0x1234567890abcdef1234567890abcdef12345678',
        chainType: 'evm',
        linkedAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
        provider: 'external',
        name: 'Main Wallet',
      },
      {
        address: '0xabcdef1234567890abcdef1234567890abcdef12',
        chainType: 'evm',
        linkedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
        provider: 'turnkey',
        name: 'Passkey Wallet',
      },
    ]
  },

  async unlinkWallet(_address: string): Promise<{ success: boolean; message: string }> {
    await delay(MOCK_DELAY)
    return {
      success: true,
      message: 'Wallet unlinked successfully',
    }
  },
}

// Type for the mock API - matches the real ApiClient interface
export type MockApiClient = typeof mockApi
