/**
 * Gecko's native-safe API surface.
 *
 * Every user-scoped endpoint below accepts the SecureStore-backed session JWT.
 * This client deliberately exposes no quote, signing, or execution primitive.
 */
import { request } from './api'
import { TIMEOUTS } from './config'
import type { ActivityEntry, AskResponse, EarnActionResponse, EarnSnapshot, HealthStatus, MobileSnapshot } from '../types/api'

export const endpoints = {
  health: () => request<HealthStatus>('/health', { timeoutMs: TIMEOUTS.fast }),

  snapshot: (signal?: AbortSignal) =>
    request<MobileSnapshot>('/v1/mobile/snapshot', { signal }),

  activity: (limit = 20, offset = 0, signal?: AbortSignal) =>
    request<ActivityEntry[]>(`/webapp/swaps?limit=${limit}&offset=${offset}`, {
      timeoutMs: TIMEOUTS.slow,
      signal,
    }),

  ask: (text: string) =>
    request<AskResponse>('/v1/mobile/ask', {
      method: 'POST',
      body: { text },
      retries: 0,
      timeoutMs: TIMEOUTS.slow,
    }),

  earn: (signal?: AbortSignal) =>
    request<EarnSnapshot>('/v1/mobile/earn', { signal }),

  // walletId is optional — omitted, the API resolves the user's default EVM
  // wallet. Not sent by the UI yet (single-wallet flow), but the shape is
  // ready for a future wallet picker.
  earnDeposit: (amount: string, walletId?: number) =>
    request<EarnActionResponse>('/v1/mobile/earn/deposit', {
      method: 'POST',
      body: walletId === undefined ? { amount } : { amount, walletId },
      retries: 0,
      timeoutMs: TIMEOUTS.slow,
    }),

  earnWithdraw: (amount: string, walletId?: number) =>
    request<EarnActionResponse>('/v1/mobile/earn/withdraw', {
      method: 'POST',
      body: walletId === undefined ? { amount } : { amount, walletId },
      retries: 0,
      timeoutMs: TIMEOUTS.slow,
    }),
} as const
