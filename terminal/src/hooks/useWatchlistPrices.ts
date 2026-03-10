import { useState, useEffect, useRef, useCallback } from 'react'
import { api } from '../lib/api'
import type { WatchlistToken } from './useWatchlist'

export interface TokenPriceData {
  price: number | null
  change24h: number | null
  loading: boolean
}

type PriceMap = Record<string, TokenPriceData>

function tokenKey(chain: string, address: string): string {
  return `${chain}:${address.toLowerCase()}`
}

const POLL_INTERVAL = 30_000

export function useWatchlistPrices(watchlist: WatchlistToken[]) {
  const [prices, setPrices] = useState<PriceMap>({})
  const intervalRef = useRef<ReturnType<typeof setInterval>>()
  const abortRef = useRef<AbortController>()

  const fetchPrices = useCallback(async () => {
    if (watchlist.length === 0) {
      setPrices({})
      return
    }

    // Cancel any in-flight request
    abortRef.current?.abort()
    abortRef.current = new AbortController()

    // Group tokens by chain for efficient lookups
    const byChain = new Map<string, WatchlistToken[]>()
    for (const token of watchlist) {
      const list = byChain.get(token.chain) || []
      list.push(token)
      byChain.set(token.chain, list)
    }

    const nextPrices: PriceMap = {}

    // Mark all as loading initially on first fetch
    for (const token of watchlist) {
      const key = tokenKey(token.chain, token.address)
      nextPrices[key] = prices[key] || { price: null, change24h: null, loading: true }
    }

    // Fetch per chain — use searchTokens which returns price-bearing SwapToken results
    const chainPromises = Array.from(byChain.entries()).map(async ([chain, tokens]) => {
      for (const token of tokens) {
        try {
          const results = await api.searchTokens(token.symbol, chain)
          const match = results.find(
            r => r.address.toLowerCase() === token.address.toLowerCase()
          ) || results.find(
            r => r.symbol.toUpperCase() === token.symbol.toUpperCase()
          )

          const key = tokenKey(token.chain, token.address)
          if (match && match.balanceUsd !== undefined) {
            nextPrices[key] = {
              price: match.balanceUsd,
              change24h: null,
              loading: false,
            }
          } else {
            nextPrices[key] = {
              price: prices[key]?.price ?? null,
              change24h: prices[key]?.change24h ?? null,
              loading: false,
            }
          }
        } catch {
          const key = tokenKey(token.chain, token.address)
          nextPrices[key] = {
            price: prices[key]?.price ?? null,
            change24h: prices[key]?.change24h ?? null,
            loading: false,
          }
        }
      }
    })

    // Also try discovery trending pools — they have priceUsd and priceChangeH24
    const trendingPromises = Array.from(byChain.keys()).map(async (chain) => {
      try {
        const pools = await api.getTrendingPools(chain, 50)
        for (const pool of pools) {
          // Match by base token address
          const matchingTokens = byChain.get(chain)?.filter(
            t => t.address.toLowerCase() === pool.baseToken.address.toLowerCase()
              || t.symbol.toUpperCase() === pool.baseToken.symbol.toUpperCase()
          )
          if (matchingTokens) {
            for (const t of matchingTokens) {
              const key = tokenKey(t.chain, t.address)
              const priceNum = pool.priceUsd ? parseFloat(pool.priceUsd) : null
              if (priceNum !== null && priceNum > 0) {
                nextPrices[key] = {
                  price: priceNum,
                  change24h: pool.priceChangeH24,
                  loading: false,
                }
              }
            }
          }
        }
      } catch {
        // Non-critical — trending might not be available for all chains
      }
    })

    await Promise.allSettled([...chainPromises, ...trendingPromises])
    setPrices({ ...nextPrices })
  }, [watchlist, prices])

  // Initial fetch
  useEffect(() => {
    fetchPrices()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchlist.length])

  // Polling
  useEffect(() => {
    if (watchlist.length === 0) return
    intervalRef.current = setInterval(fetchPrices, POLL_INTERVAL)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [watchlist.length, fetchPrices])

  const getPrice = useCallback(
    (chain: string, address: string): TokenPriceData =>
      prices[tokenKey(chain, address)] || { price: null, change24h: null, loading: false },
    [prices]
  )

  return { prices, getPrice, refetch: fetchPrices }
}
