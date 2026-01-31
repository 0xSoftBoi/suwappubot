import { describe, it, expect, beforeEach } from 'bun:test'
import { renderHook, act } from '@testing-library/react'
import { useFavoriteTokens, useFavoritePairs } from './useFavorites'

// Mock localStorage
let store: Record<string, string> = {}
const localStorageMock = {
  getItem: (key: string) => store[key] || null,
  setItem: (key: string, value: string) => { store[key] = value },
  removeItem: (key: string) => { delete store[key] },
  clear: () => { store = {} },
}

// @ts-ignore
globalThis.localStorage = localStorageMock

describe('useFavoriteTokens', () => {
  beforeEach(() => {
    store = {}
  })

  it('should start with empty favorites', () => {
    const { result } = renderHook(() => useFavoriteTokens())
    expect(result.current.favorites).toEqual([])
  })

  it('should add a favorite token', () => {
    const { result } = renderHook(() => useFavoriteTokens())
    
    act(() => {
      result.current.addFavorite({
        symbol: 'ETH',
        name: 'Ethereum',
        address: '0x0',
        chain: 'ethereum',
      })
    })

    expect(result.current.favorites).toHaveLength(1)
    expect(result.current.favorites[0].symbol).toBe('ETH')
    // Verify localStorage was updated
    expect(store['suwappu_favorite_tokens']).toBeDefined()
  })

  it('should not add duplicate favorites', () => {
    const { result } = renderHook(() => useFavoriteTokens())
    
    const token = {
      symbol: 'ETH',
      name: 'Ethereum',
      address: '0x0',
      chain: 'ethereum',
    }

    act(() => {
      result.current.addFavorite(token)
      result.current.addFavorite(token)
    })

    expect(result.current.favorites).toHaveLength(1)
  })

  it('should remove a favorite token', () => {
    const { result } = renderHook(() => useFavoriteTokens())
    
    act(() => {
      result.current.addFavorite({
        symbol: 'ETH',
        name: 'Ethereum',
        address: '0x0',
        chain: 'ethereum',
      })
    })

    act(() => {
      result.current.removeFavorite('0x0', 'ethereum')
    })

    expect(result.current.favorites).toHaveLength(0)
  })

  it('should check if token is favorite', () => {
    const { result } = renderHook(() => useFavoriteTokens())
    
    act(() => {
      result.current.addFavorite({
        symbol: 'ETH',
        name: 'Ethereum',
        address: '0x0',
        chain: 'ethereum',
      })
    })

    expect(result.current.isFavorite('0x0', 'ethereum')).toBe(true)
    expect(result.current.isFavorite('0x1', 'ethereum')).toBe(false)
  })

  it('should toggle favorite', () => {
    const { result } = renderHook(() => useFavoriteTokens())
    
    const token = {
      symbol: 'ETH',
      name: 'Ethereum',
      address: '0x0',
      chain: 'ethereum',
    }

    act(() => {
      result.current.toggleFavorite(token)
    })
    expect(result.current.favorites).toHaveLength(1)

    act(() => {
      result.current.toggleFavorite(token)
    })
    expect(result.current.favorites).toHaveLength(0)
  })
})

describe('useFavoritePairs', () => {
  beforeEach(() => {
    store = {}
  })

  it('should start with empty pairs', () => {
    const { result } = renderHook(() => useFavoritePairs())
    expect(result.current.pairs).toEqual([])
  })

  it('should add a favorite pair', () => {
    const { result } = renderHook(() => useFavoritePairs())
    
    act(() => {
      result.current.addPair({
        fromToken: 'ETH',
        fromChain: 'ethereum',
        toToken: 'USDC',
        toChain: 'ethereum',
      })
    })

    expect(result.current.pairs).toHaveLength(1)
    expect(result.current.pairs[0].fromToken).toBe('ETH')
    expect(result.current.pairs[0].toToken).toBe('USDC')
    expect(result.current.pairs[0].useCount).toBe(0)
  })

  it('should increment use count', () => {
    const { result } = renderHook(() => useFavoritePairs())
    
    act(() => {
      result.current.addPair({
        fromToken: 'ETH',
        fromChain: 'ethereum',
        toToken: 'USDC',
        toChain: 'ethereum',
      })
    })

    const pairId = result.current.pairs[0].id

    act(() => {
      result.current.incrementUseCount(pairId)
    })
    act(() => {
      result.current.incrementUseCount(pairId)
    })

    expect(result.current.pairs[0].useCount).toBe(2)
  })

  it('should check if pair is favorite', () => {
    const { result } = renderHook(() => useFavoritePairs())
    
    act(() => {
      result.current.addPair({
        fromToken: 'ETH',
        fromChain: 'ethereum',
        toToken: 'USDC',
        toChain: 'ethereum',
      })
    })

    expect(result.current.isPairFavorite('ETH', 'ethereum', 'USDC', 'ethereum')).toBe(true)
    expect(result.current.isPairFavorite('SOL', 'solana', 'USDC', 'solana')).toBe(false)
  })

  it('should remove a pair', () => {
    const { result } = renderHook(() => useFavoritePairs())
    
    act(() => {
      result.current.addPair({
        fromToken: 'ETH',
        fromChain: 'ethereum',
        toToken: 'USDC',
        toChain: 'ethereum',
      })
    })

    const pairId = result.current.pairs[0].id

    act(() => {
      result.current.removePair(pairId)
    })

    expect(result.current.pairs).toHaveLength(0)
  })
})
