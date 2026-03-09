import { useState, useCallback, useEffect } from 'react'

export interface WatchlistToken {
  symbol: string
  address: string
  chain: string
  name: string
}

const STORAGE_KEY = 'suwappu_watchlist'

function loadWatchlist(): WatchlistToken[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    return JSON.parse(raw) as WatchlistToken[]
  } catch {
    return []
  }
}

function saveWatchlist(list: WatchlistToken[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
}

export function useWatchlist() {
  const [watchlist, setWatchlist] = useState<WatchlistToken[]>(loadWatchlist)

  // Sync across tabs
  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) {
        setWatchlist(loadWatchlist())
      }
    }
    window.addEventListener('storage', handler)
    return () => window.removeEventListener('storage', handler)
  }, [])

  const addToken = useCallback((token: WatchlistToken) => {
    setWatchlist(prev => {
      const exists = prev.some(
        t => t.address.toLowerCase() === token.address.toLowerCase() && t.chain === token.chain
      )
      if (exists) return prev
      const next = [...prev, token]
      saveWatchlist(next)
      return next
    })
  }, [])

  const removeToken = useCallback((address: string, chain: string) => {
    setWatchlist(prev => {
      const next = prev.filter(
        t => !(t.address.toLowerCase() === address.toLowerCase() && t.chain === chain)
      )
      saveWatchlist(next)
      return next
    })
  }, [])

  const isWatched = useCallback(
    (address: string, chain: string) =>
      watchlist.some(
        t => t.address.toLowerCase() === address.toLowerCase() && t.chain === chain
      ),
    [watchlist]
  )

  return { watchlist, addToken, removeToken, isWatched }
}
