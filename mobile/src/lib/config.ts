import Constants from 'expo-constants'

const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, unknown>

/**
 * Base URL for api-ts. Overridable per-build via app.json `extra.apiUrl` or the
 * EXPO_PUBLIC_API_URL env var (inlined at bundle time).
 */
export const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_URL ?? (extra.apiUrl as string | undefined) ?? 'https://api.suwappu.bot'

/** Per-request timeout budgets. */
export const TIMEOUTS = {
  fast: 6_000,
  default: 12_000,
  slow: 30_000,
} as const
