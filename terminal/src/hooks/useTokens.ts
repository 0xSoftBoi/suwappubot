import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import type { SwapToken } from '../types/api'

function useDebouncedValue(value: string, delayMs = 180) {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebounced(value), delayMs)
    return () => window.clearTimeout(timeout)
  }, [delayMs, value])

  return debounced
}

function dedupeTokens(tokens: SwapToken[] = []) {
  const seen = new Set<string>()
  return tokens.filter((token) => {
    const address = token.address.toLowerCase()
    const nativeKey = `${token.chain}:${token.symbol}:native`
    const key = address === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' ||
      address === '0x0000000000000000000000000000000000000000'
      ? nativeKey
      : `${token.chain}:${address}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function usePopularTokens(chain?: string) {
  return useQuery({
    queryKey: ['popular-tokens', chain],
    queryFn: () => api.getPopularTokens(chain),
    staleTime: 60_000,
  })
}

export function useSearchTokens(query: string, chain?: string) {
  return useQuery({
    queryKey: ['token-search', query, chain],
    queryFn: () => api.searchTokens(query, chain),
    enabled: query.length >= 1,
    staleTime: 30_000,
  })
}

export function useTokenSelectorTokens(search: string, chain?: string, enabled = true) {
  const trimmedSearch = search.trim()
  const debouncedSearch = useDebouncedValue(trimmedSearch)
  const shouldSearch = debouncedSearch.length >= 2 || debouncedSearch.startsWith('0x')
  const normalizedChain = chain || 'ethereum'

  return useQuery({
    queryKey: shouldSearch
      ? ['token-search', normalizedChain, debouncedSearch]
      : ['popular-tokens', normalizedChain],
    queryFn: async () => {
      const tokens = shouldSearch
        ? await api.searchTokens(debouncedSearch, normalizedChain)
        : await api.getPopularTokens(normalizedChain)
      return dedupeTokens(tokens)
    },
    enabled,
    placeholderData: (previous) => previous,
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
  })
}

export function useChains() {
  return useQuery({
    queryKey: ['chains'],
    queryFn: () => api.getChains(),
    staleTime: 300_000,
  })
}
