/**
 * TanStack Query setup, tuned for mobile.
 *
 * Two decisions carry most of the perceived-performance win:
 *
 *  1. **Non-sensitive persisted cache.** Query persistence is available for
 *     public health/config reads. Account snapshots and activity remain
 *     memory-only until an encrypted per-install cache exists.
 *
 *  2. **Per-data-class staleness.** Account analytics and activity change at
 *     different rates, so each gets an explicit cache budget.
 */
import { QueryClient, focusManager, onlineManager } from '@tanstack/react-query'
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister'
import { AppState, type AppStateStatus } from 'react-native'
import NetInfo from '@react-native-community/netinfo'
import { mmkvAsyncStorage } from './storage'
import { ApiError } from './api'

/** How long each class of data stays fresh. */
export const STALE = {
  /** Account snapshot: fresh enough for a Today surface without constant polling. */
  balance: 15_000,
  /** Activity changes only when the user acts. */
  activity: 60_000,
  /** Earn position/APY: fresh enough without polling a yield rate every render. */
  earn: 15_000,
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
 * Only successful non-user data is persisted. Financial snapshot/activity
 * data must never land in plaintext MMKV.
 */
export const persistOptions = {
  persister,
  maxAge: 24 * 60 * 60 * 1000,
  buster: 'gecko-v0',
  dehydrateOptions: {
    shouldDehydrateQuery: (query: { queryKey: readonly unknown[]; state: { status: string } }) => {
      return query.state.status === 'success' && query.queryKey[0] === 'health'
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
