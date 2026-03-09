/**
 * Live Activity support for swap/transaction progress.
 *
 * iOS 16.1+ Live Activities show real-time status on the lock screen
 * and Dynamic Island. This module provides the data layer for a future
 * native ActivityKit integration.
 *
 * Flow:
 *   1. User initiates swap → startSwapActivity()
 *   2. Polling updates status → updateSwapActivity()
 *   3. Swap completes/fails → endSwapActivity()
 *
 * The actual ActivityKit calls require a native Swift extension.
 * This module manages the state and provides the bridge interface.
 */
import * as SecureStore from 'expo-secure-store'

const ACTIVE_ACTIVITY_KEY = 'live_activity_current'

export type SwapActivityStatus = 'pending' | 'confirming' | 'bridging' | 'completed' | 'failed'

export interface SwapActivityData {
  id: string
  fromToken: string
  toToken: string
  fromAmount: string
  toAmount?: string
  fromChain: string
  toChain: string
  status: SwapActivityStatus
  txHash?: string
  startedAt: string
  updatedAt: string
}

/**
 * Start a Live Activity for a swap in progress.
 */
export async function startSwapActivity(data: Omit<SwapActivityData, 'updatedAt'>): Promise<void> {
  const activity: SwapActivityData = {
    ...data,
    updatedAt: new Date().toISOString(),
  }
  await SecureStore.setItemAsync(ACTIVE_ACTIVITY_KEY, JSON.stringify(activity))

  // TODO: Native bridge call
  // NativeModules.LiveActivityBridge.startSwapActivity(activity)
}

/**
 * Update the current Live Activity with new status.
 */
export async function updateSwapActivity(
  status: SwapActivityStatus,
  toAmount?: string,
): Promise<void> {
  const raw = await SecureStore.getItemAsync(ACTIVE_ACTIVITY_KEY)
  if (!raw) return

  const activity: SwapActivityData = JSON.parse(raw)
  activity.status = status
  activity.updatedAt = new Date().toISOString()
  if (toAmount) activity.toAmount = toAmount

  await SecureStore.setItemAsync(ACTIVE_ACTIVITY_KEY, JSON.stringify(activity))

  // TODO: Native bridge call
  // NativeModules.LiveActivityBridge.updateSwapActivity({ status, toAmount })
}

/**
 * End the current Live Activity.
 */
export async function endSwapActivity(): Promise<void> {
  await SecureStore.deleteItemAsync(ACTIVE_ACTIVITY_KEY)

  // TODO: Native bridge call
  // NativeModules.LiveActivityBridge.endSwapActivity()
}

/**
 * Get the current active swap activity (if any).
 */
export async function getCurrentActivity(): Promise<SwapActivityData | null> {
  const raw = await SecureStore.getItemAsync(ACTIVE_ACTIVITY_KEY)
  return raw ? JSON.parse(raw) : null
}
