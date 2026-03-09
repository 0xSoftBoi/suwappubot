/**
 * Tests for the useWatchlist hook.
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals'

// Mock react-query
const mockUseQuery = jest.fn()
const mockUseMutation = jest.fn()
const mockInvalidateQueries = jest.fn()

jest.mock('@tanstack/react-query', () => ({
  useQuery: (...args: any[]) => mockUseQuery(...args),
  useMutation: (...args: any[]) => mockUseMutation(...args),
  useQueryClient: () => ({
    invalidateQueries: mockInvalidateQueries,
  }),
}))

jest.mock('../../lib/api', () => ({
  api: {
    getWatchlist: jest.fn(),
    addToWatchlist: jest.fn(),
    removeFromWatchlist: jest.fn(),
  },
}))

describe('useWatchlist', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns watchlist data from useQuery', () => {
    const mockWatchlist = [
      { symbol: 'ETH', chain: 'ethereum', addedAt: '2026-01-01' },
      { symbol: 'SOL', chain: 'solana', addedAt: '2026-01-02' },
    ]

    mockUseQuery.mockReturnValue({
      data: mockWatchlist,
      isLoading: false,
      error: null,
    })

    // Manually test the hook config
    const { useWatchlist } = require('../../hooks/useWatchlist')
    const result = useWatchlist()

    expect(result.data).toEqual(mockWatchlist)
    expect(result.isLoading).toBe(false)
  })

  it('handles empty watchlist', () => {
    mockUseQuery.mockReturnValue({
      data: [],
      isLoading: false,
      error: null,
    })

    const { useWatchlist } = require('../../hooks/useWatchlist')
    const result = useWatchlist()

    expect(result.data).toEqual([])
  })
})
