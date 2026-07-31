/**
 * TanStack Query setup, tuned for mobile.
 *
 * Two decisions carry most of the perceived-performance win:
 *
 *  1. **Persisted cache.** The cache is written to MMKV and rehydrated
 *     synchronously on boot, so a cold start paints the user's real portfolio
 *     immediately instead of a skeleton. The network refresh then swaps in
 *     under it. Stale-then-fresh beats spinner-then-fresh every time.
 *
 *  2. **Per-data-class staleness.** Treating a swap quote and a chain list with
 *     the same staleTime is the usual mistake: either quotes go stale-priced or
 *     static config gets refetched on every focus, burning battery and data.
 *     `STALE` below encodes how fast each kind of data actually changes.
 */
import { QueryClient, focusManager, onlineManager } from '@tanstack/react-query'
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister'
import { AppState, type AppStateStatus } from 'react-native'
import NetInfo from '@react-native-community/netinfo'
import { mmkvAsyncStorage } from './storage'
import { ApiError } from './api'

/** How long each class of data stays fresh. */
export const STALE = {
  /** Prices move constantly — always refetch, but dedupe bursts. */
  realtime: 5_000,
  /** Balances/portfolio: stale after a few seconds, cheap to refresh. */
  balance: 15_000,
  /** Swap history, orders: changes only when the user acts. */
  activity: 60_000,
  /** Token lists, chain config, fee tiers: effectively static per session. */
  config: 24 * 60 * 60 * 1000,
} as const

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: STALE.balance,
      // Keep data around for a day so returning users get an instant paint.
      gcTime: 24 * 60 * 60 * 1000,
      retry: (failureCount, error) => {
        // The api layer already retries transport failures. Only let Query
        // retry on top of that for server errors, and never for 4xx.
        if (error instanceof ApiError && !error.retryable) return false
        return failureCount < 1
      },
      // Refetch when the app returns to the foreground, not on every remount.
      refetchOnWindowFocus: true,
      refetchOnMount: false,
      refetchOnReconnect: true,
      // Structural sharing keeps object identity stable across refetches, so a
      // poll that returns identical data does not re-render the whole list.
      structuralSharing: true,
      networkMode: 'offlineFirst',
    },
    mutations: {
      retry: 0,
      networkMode: 'online',
    },
  },
})

export const persister = createAsyncStoragePersister({
  storage: mmkvAsyncStorage,
  key: 'suwappu.query-cache.v1',
  throttleTime: 2_000,
})

/**
 * Only persist queries that are safe and useful across launches. Quotes are
 * excluded deliberately — a restored quote is a stale price, and showing a
 * stale price on a swap screen is a correctness bug, not a caching win.
 */
export const persistOptions = {
  persister,
  maxAge: 24 * 60 * 60 * 1000,
  buster: 'v1',
  dehydrateOptions: {
    shouldDehydrateQuery: (query: { queryKey: readonly unknown[]; state: { status: string } }) => {
      if (query.state.status !== 'success') return false
      const root = query.queryKey[0]
      return root !== 'quote' && root !== 'swap-status'
    },
  },
}

/**
 * Wire Query's focus/online managers to real React Native signals. Without
 * this, Query assumes a browser: it never knows the app was backgrounded and
 * keeps polling in the background, and it never knows the device went offline
 * so it burns retries against a dead radio.
 */
export function installAppStateBridges(): () => void {
  const appStateSub = AppState.addEventListener('change', (status: AppStateStatus) => {
    focusManager.setFocused(status === 'active')
  })

  // `setEventListener` returns void — it hands the manager a setup function and
  // keeps the teardown internally, so we hold our own handle to NetInfo.
  let unsubscribeNet: (() => void) | undefined
  onlineManager.setEventListener((setOnline) => {
    unsubscribeNet = NetInfo.addEventListener((state) => {
      setOnline(Boolean(state.isConnected && state.isInternetReachable !== false))
    })
    return unsubscribeNet
  })

  return () => {
    appStateSub.remove()
    unsubscribeNet?.()
  }
}
