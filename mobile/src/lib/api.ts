/**
 * Network layer for the Suwappu mobile app.
 *
 * Talks to the same api-ts endpoints as the webapp, but adds four things that
 * matter far more on a phone than in a browser tab:
 *
 *  1. In-flight deduplication. Three components mounting at once and each
 *     asking for the portfolio should produce ONE request, not three. On LTE
 *     that is the difference between 400ms and 1.2s.
 *  2. Hard timeouts with AbortController. A request on a flaky cell connection
 *     will otherwise hang until the OS gives up (~75s on iOS), pinning a
 *     spinner on screen the whole time.
 *  3. Retry with exponential backoff + jitter, and only on retryable failures.
 *     Never retry a non-idempotent POST — replaying a swap execution is how you
 *     charge a user twice.
 *  4. ETag-based conditional requests. Token lists and chain configs barely
 *     change; a 304 costs ~200 bytes instead of ~200KB.
 *
 * Every call is timed through perf.ts so slow endpoints surface as data.
 */
import { API_BASE_URL, IS_DEV_API, TIMEOUTS } from './config'
import { getAuthToken, getInitData } from './auth'
import { kv } from './storage'
import { mark, measure } from './perf'

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly detail: string,
    public readonly endpoint: string,
  ) {
    super(`${status} ${detail}`)
    this.name = 'ApiError'
  }

  /** 4xx (except 408/429) means the request itself is wrong — retrying won't help. */
  get retryable(): boolean {
    if (this.status === 408 || this.status === 429) return true
    return this.status >= 500 || this.status === 0
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  body?: unknown
  /** Timeout budget. Defaults to TIMEOUTS.default. */
  timeoutMs?: number
  /** Max retry attempts for retryable failures. GETs default to 2, writes to 0. */
  retries?: number
  /** Send If-None-Match and serve the cached body on 304. GET only. */
  conditional?: boolean
  signal?: AbortSignal
}

// --- in-flight dedupe -------------------------------------------------------

const inFlight = new Map<string, Promise<unknown>>()

// --- ETag cache -------------------------------------------------------------

const ETAG_PREFIX = 'etag:'
const BODY_PREFIX = 'etagbody:'

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = {}
  const initData = getInitData()
  if (initData) headers['X-Telegram-Init-Data'] = initData
  const token = getAuthToken()
  if (token) headers.Authorization = `Bearer ${token}`
  if (IS_DEV_API) headers['X-Dev-User-Id'] = '12345'
  return headers
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Full jitter backoff. Without jitter, every client that failed during a blip
 * retries in lockstep and re-DDoSes the API the moment it recovers.
 */
function backoffMs(attempt: number): number {
  const ceiling = Math.min(8_000, 500 * 2 ** attempt)
  return Math.random() * ceiling
}

async function execute<T>(endpoint: string, opts: RequestOptions): Promise<T> {
  const method = opts.method ?? 'GET'
  const isRead = method === 'GET'
  const maxRetries = opts.retries ?? (isRead ? 2 : 0)
  const timeoutMs = opts.timeoutMs ?? TIMEOUTS.default
  const useConditional = Boolean(opts.conditional) && isRead

  let lastError: unknown

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    // Caller-driven cancellation (screen unmounted, query invalidated) must
    // also tear down the in-flight socket, not just ignore the result.
    const onExternalAbort = () => controller.abort()
    opts.signal?.addEventListener('abort', onExternalAbort)

    const perfKey = `net ${method} ${endpoint.split('?')[0]}`
    mark(perfKey)

    try {
      const headers: Record<string, string> = {
        Accept: 'application/json',
        ...authHeaders(),
      }
      if (opts.body !== undefined) headers['Content-Type'] = 'application/json'

      const cachedEtag = useConditional ? kv.getString(ETAG_PREFIX + endpoint) : undefined
      if (cachedEtag) headers['If-None-Match'] = cachedEtag

      const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        method,
        headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        signal: controller.signal,
      })

      measure(perfKey, timeoutMs / 2)

      // 304: server confirms our copy is current. Zero-cost refresh.
      if (response.status === 304 && useConditional) {
        const cached = kv.getString(BODY_PREFIX + endpoint)
        if (cached) return JSON.parse(cached) as T
        // Cache was evicted under us — fall through and refetch unconditionally.
        kv.delete(ETAG_PREFIX + endpoint)
        throw new ApiError(0, 'etag cache miss', endpoint)
      }

      if (!response.ok) {
        let detail = 'Request failed'
        try {
          const body = await response.json()
          detail = body?.detail ?? body?.message ?? detail
        } catch {
          // Non-JSON error body (gateway HTML, empty 502). Keep the default.
        }
        throw new ApiError(response.status, detail, endpoint)
      }

      const text = await response.text()
      const parsed = (text ? JSON.parse(text) : null) as T

      if (useConditional) {
        const etag = response.headers.get('etag')
        if (etag) {
          kv.set(ETAG_PREFIX + endpoint, etag)
          kv.set(BODY_PREFIX + endpoint, text)
        }
      }

      return parsed
    } catch (err) {
      measure(perfKey, timeoutMs / 2)
      lastError = err

      // An abort we caused via opts.signal is a cancellation, not a failure.
      if (opts.signal?.aborted) throw err

      const isTimeout = err instanceof Error && err.name === 'AbortError'
      const retryable = isTimeout || (err instanceof ApiError ? err.retryable : true)

      if (attempt < maxRetries && retryable) {
        await sleep(backoffMs(attempt))
        continue
      }
      if (isTimeout) throw new ApiError(408, `timed out after ${timeoutMs}ms`, endpoint)
      throw err
    } finally {
      clearTimeout(timer)
      opts.signal?.removeEventListener('abort', onExternalAbort)
    }
  }

  throw lastError
}

/**
 * Public entry point. GETs with identical keys share a single in-flight promise.
 */
export function request<T>(endpoint: string, opts: RequestOptions = {}): Promise<T> {
  const method = opts.method ?? 'GET'
  if (method !== 'GET') return execute<T>(endpoint, opts)

  const key = `${method} ${endpoint}`
  const existing = inFlight.get(key) as Promise<T> | undefined
  if (existing) return existing

  const promise = execute<T>(endpoint, opts).finally(() => {
    inFlight.delete(key)
  })
  inFlight.set(key, promise)
  return promise
}

/** Drop every cached ETag body — call on sign-out so no user data leaks across accounts. */
export function clearHttpCache(): void {
  for (const key of kv.getAllKeys()) {
    if (key.startsWith(ETAG_PREFIX) || key.startsWith(BODY_PREFIX)) kv.delete(key)
  }
}
