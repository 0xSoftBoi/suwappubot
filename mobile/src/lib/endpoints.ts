/**
 * Gecko's native-safe API surface.
 *
 * Every user-scoped endpoint below accepts the SecureStore-backed session JWT.
 * This client deliberately exposes no quote, signing, or execution primitive.
 */
import { request } from './api'
import { TIMEOUTS } from './config'
import type { ActivityEntry, AskResponse, HealthStatus, MobileSnapshot } from '../types/api'

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
} as const
