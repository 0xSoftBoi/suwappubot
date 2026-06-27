import { useState, useEffect } from 'react'
import { api } from '../lib/api'

export type SubscriptionTier = 'free' | 'pro' | 'premium' | 'enterprise'

const CACHE_KEY = 'suwappu_subscription_tier'
const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

interface CachedTier {
  tier: SubscriptionTier
  fetchedAt: number
}

function getCached(): SubscriptionTier | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const cached: CachedTier = JSON.parse(raw)
    if (Date.now() - cached.fetchedAt > CACHE_TTL_MS) return null
    return cached.tier
  } catch {
    return null
  }
}

function setCache(tier: SubscriptionTier) {
  try {
    const value: CachedTier = { tier, fetchedAt: Date.now() }
    localStorage.setItem(CACHE_KEY, JSON.stringify(value))
  } catch {
    // ignore storage errors
  }
}

/**
 * Returns the current user's subscription tier.
 * Null while loading. Falls back to 'free' on error.
 * Caches the result in localStorage for 5 minutes to avoid repeated fetches.
 */
export function useSubscriptionTier(): SubscriptionTier | null {
  const [tier, setTier] = useState<SubscriptionTier | null>(() => getCached())

  useEffect(() => {
    // If we have a non-expired cached value, skip the fetch
    const cached = getCached()
    if (cached) {
      setTier(cached)
      return
    }

    let cancelled = false

    api
      .getSubscriptionStatus()
      .then((status) => {
        if (cancelled) return
        const resolved = (status.tier as SubscriptionTier) || 'free'
        setTier(resolved)
        setCache(resolved)
      })
      .catch(() => {
        if (cancelled) return
        setTier('free')
      })

    return () => {
      cancelled = true
    }
  }, [])

  return tier
}
