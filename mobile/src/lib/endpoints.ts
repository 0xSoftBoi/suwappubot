/**
 * Thin typed wrappers over `request()`. One function per api-ts endpoint,
 * with the timeout / retry / conditional-caching policy for that endpoint
 * chosen here rather than at every call site.
 */
import { request } from './api'
import { TIMEOUTS } from './config'
import type { Portfolio, Swap, SwapQuote, Token, Wallet, HealthStatus } from '../types/api'

export const endpoints = {
  health: () => request<HealthStatus>('/health', { timeoutMs: TIMEOUTS.fast }),

  portfolio: (signal?: AbortSignal) =>
    request<Portfolio>('/webapp/users/me/portfolio', { signal }),

  wallet: () => request<Wallet>('/webapp/wallets/default', { method: 'POST' }),

  swaps: (limit = 20, offset = 0, signal?: AbortSignal) =>
    request<Swap[]>(`/webapp/users/me/swaps?limit=${limit}&offset=${offset}`, {
      timeoutMs: TIMEOUTS.slow,
      signal,
    }),

  swapStatus: (id: string) =>
    request<Swap>(`/webapp/swap/${encodeURIComponent(id)}/status`, {
      timeoutMs: TIMEOUTS.fast,
    }),

  /**
   * Token lists are large and change rarely — exactly the case ETags were
   * designed for. A warm client pays ~200 bytes here instead of the full list.
   */
  tokens: (chain: string) =>
    request<Token[]>(`/webapp/swap/tokens?chain=${encodeURIComponent(chain)}`, {
      conditional: true,
      timeoutMs: TIMEOUTS.slow,
    }),

  /**
   * Quotes are priced and short-lived: no retry (a retried quote is a stale
   * quote), tight timeout, never cached.
   */
  quote: (
    body: { fromChain: string; toChain: string; fromToken: string; toToken: string; amount: string },
    signal?: AbortSignal,
  ) =>
    request<SwapQuote>('/webapp/swap/quote', {
      method: 'POST',
      body,
      retries: 0,
      timeoutMs: TIMEOUTS.fast,
      signal,
    }),

  /** Execution is non-idempotent. Zero retries, long timeout, never deduped. */
  executeSwap: (body: { quoteId: string }) =>
    request<Swap>('/webapp/swap/execute', {
      method: 'POST',
      body,
      retries: 0,
      timeoutMs: TIMEOUTS.slow,
    }),
} as const
