import { useState, useEffect, useCallback } from 'react'

export interface FavoriteToken {
  symbol: string
  name: string
  address: string
  chain: string
  logoUrl?: string
  addedAt: number
}

export interface FavoritePair {
  id: string
  fromToken: string
  fromChain: string
  toToken: string
  toChain: string
  name?: string
  useCount: number
  addedAt: number
}

const FAVORITES_KEY = 'suwappu_favorite_tokens'
const PAIRS_KEY = 'suwappu_favorite_pairs'

export function useFavoriteTokens() {
  const [favorites, setFavorites] = useState<FavoriteToken[]>([])

  // Load from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem(FAVORITES_KEY)
      if (stored) {
        setFavorites(JSON.parse(stored))
      }
    } catch {
      console.warn('Failed to load favorite tokens')
    }
  }, [])

  // Save to localStorage
  const saveFavorites = useCallback((newFavorites: FavoriteToken[]) => {
    setFavorites(newFavorites)
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(newFavorites))
  }, [])

  const addFavorite = useCallback((token: Omit<FavoriteToken, 'addedAt'>) => {
    const exists = favorites.some(f => f.address === token.address && f.chain === token.chain)
    if (!exists) {
      saveFavorites([...favorites, { ...token, addedAt: Date.now() }])
    }
  }, [favorites, saveFavorites])

  const removeFavorite = useCallback((address: string, chain: string) => {
    saveFavorites(favorites.filter(f => !(f.address === address && f.chain === chain)))
  }, [favorites, saveFavorites])

  const isFavorite = useCallback((address: string, chain: string) => {
    return favorites.some(f => f.address === address && f.chain === chain)
  }, [favorites])

  const toggleFavorite = useCallback((token: Omit<FavoriteToken, 'addedAt'>) => {
    if (isFavorite(token.address, token.chain)) {
      removeFavorite(token.address, token.chain)
    } else {
      addFavorite(token)
    }
  }, [isFavorite, addFavorite, removeFavorite])

  return {
    favorites,
    addFavorite,
    removeFavorite,
    isFavorite,
    toggleFavorite,
  }
}

export function useFavoritePairs() {
  const [pairs, setPairs] = useState<FavoritePair[]>([])

  useEffect(() => {
    try {
      const stored = localStorage.getItem(PAIRS_KEY)
      if (stored) {
        setPairs(JSON.parse(stored))
      }
    } catch {
      console.warn('Failed to load favorite pairs')
    }
  }, [])

  const savePairs = useCallback((newPairs: FavoritePair[]) => {
    setPairs(newPairs)
    localStorage.setItem(PAIRS_KEY, JSON.stringify(newPairs))
  }, [])

  const addPair = useCallback((pair: Omit<FavoritePair, 'id' | 'useCount' | 'addedAt'>) => {
    const id = `${pair.fromChain}-${pair.fromToken}-${pair.toChain}-${pair.toToken}`
    const exists = pairs.some(p => p.id === id)
    if (!exists) {
      savePairs([...pairs, { ...pair, id, useCount: 0, addedAt: Date.now() }])
    }
  }, [pairs, savePairs])

  const removePair = useCallback((id: string) => {
    savePairs(pairs.filter(p => p.id !== id))
  }, [pairs, savePairs])

  const incrementUseCount = useCallback((id: string) => {
    savePairs(pairs.map(p => p.id === id ? { ...p, useCount: p.useCount + 1 } : p))
  }, [pairs, savePairs])

  const isPairFavorite = useCallback((fromToken: string, fromChain: string, toToken: string, toChain: string) => {
    const id = `${fromChain}-${fromToken}-${toChain}-${toToken}`
    return pairs.some(p => p.id === id)
  }, [pairs])

  return {
    pairs,
    addPair,
    removePair,
    incrementUseCount,
    isPairFavorite,
  }
}
