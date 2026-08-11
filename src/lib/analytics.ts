/**
 * Gecko's product-analytics client.
 *
 * Deliberately dependency-free: adding posthog-react-native (or any native
 * module) would force a native rebuild, so this buffers events in JS and
 * POSTs them to Suwappu's own backend sink (`/v1/mobile/events`) using the
 * app's existing request helper + auth. The sink is a plain REST endpoint —
 * api-ts owns fanning events out to PostHog/Amplitude/whatever later, so
 * nothing at any call site below has to change when that forwarder ships.
 *
 * Three hard rules, because this is a money app:
 *  1. Never throw into render or block a user action. Every public method is
 *     wrapped so a bug here can't take down a screen or a swap.
 *  2. No PII, ever. `redactProps` drops wallet addresses, tx hashes, ENS
 *     names, emails, and any raw amount — amounts must arrive pre-bucketed
 *     via `bucketUsd`. This is defense in depth on top of the typed event
 *     map: even a bad call site can't leak an address string.
 *  3. No retry storms. One retry per batch, then the batch is dropped. The
 *     buffer itself is capped — a long offline/signed-out stretch drops the
 *     oldest events rather than growing forever.
 */
import { endpoints } from './endpoints'
import { isAuthenticated } from './auth'
import { bucketUsd, redactProps, type UsdBucket } from './analytics-privacy'

export { bucketUsd, redactProps, type UsdBucket }

// --- typed event map ---------------------------------------------------------

type FundingMethod = 'bot_wallet_pull' | 'address_qr' | 'card_onramp'
type ResultStatus = 'ok' | 'pending' | 'error'

export interface AnalyticsEventMap {
  app_opened: { entry_source: 'cold' | 'deeplink' | 'push' | 'notif'; is_first_open?: boolean }
  screen_viewed: { screen_name: string; signed_in?: boolean }
  empty_state_seen: { screen: string }

  earn_deposit_submitted: { amount_bucket: UsdBucket; source?: 'suggested' | 'manual' }
  earn_deposit_result: { status: ResultStatus; http_status?: number; amount_bucket: UsdBucket }
  earn_withdraw_submitted: { amount_bucket: UsdBucket }
  earn_withdraw_result: { status: ResultStatus; http_status?: number; amount_bucket: UsdBucket }

  send_submitted: { recipient_type: 'ens' | 'hex' }
  send_result: { status: ResultStatus; http_status?: number; amount_bucket: UsdBucket; recipient_type: 'ens' | 'hex' }

  goal_created: Record<string, never>
  goal_deleted: Record<string, never>

  statement_month_changed: { direction: 'prev' | 'next' }

  // Defined now for the funding UI another agent is building — no call site
  // fires these yet, but the shape is locked in so that work doesn't also
  // need to touch this file.
  funding_method_shown: { method: FundingMethod }
  funding_method_chosen: { method: FundingMethod }
}

// --- buffered client ----------------------------------------------------------

interface QueuedEvent {
  event: string
  props: Record<string, unknown>
  ts: number
}

const MAX_BUFFER = 200
const BATCH_SIZE = 20
const FLUSH_INTERVAL_MS = 10_000

let buffer: QueuedEvent[] = []
let distinctId: string | null = null
let inFlightFlush = false
let loopStarted = false

function ensureLoopStarted(): void {
  if (loopStarted) return
  loopStarted = true
  // One interval for the app session — mirrors perf.ts's bounded-sample
  // pattern. Re-checks auth state each tick, so events queued while signed
  // out start flushing on the very first tick after sign-in.
  setInterval(() => {
    void flush()
  }, FLUSH_INTERVAL_MS)
}

function enqueue(event: string, rawProps?: Record<string, unknown>): void {
  try {
    ensureLoopStarted()
    const props = redactProps(rawProps)
    buffer.push({ event, props, ts: Date.now() })
    if (buffer.length > MAX_BUFFER) {
      // Cap, don't grow forever — drop the oldest and keep the freshest signal.
      buffer = buffer.slice(buffer.length - MAX_BUFFER)
    }
    if (buffer.length >= BATCH_SIZE) void flush()
  } catch {
    // Analytics must never throw into a render path or an action handler.
  }
}

async function postBatch(batch: QueuedEvent[]): Promise<void> {
  await endpoints.events(batch, distinctId)
}

async function flush(): Promise<void> {
  try {
    if (inFlightFlush || buffer.length === 0) return
    // Queue while signed out; only ever sent once authed. Never blocks or
    // errors the caller — just no-ops until the next tick/enqueue.
    if (!isAuthenticated()) return

    inFlightFlush = true
    const batch = buffer.slice(0, BATCH_SIZE)
    // Remove optimistically: a failed batch (after its one retry) is
    // dropped, not requeued — no retry storms, no unbounded growth.
    buffer = buffer.slice(batch.length)

    try {
      await postBatch(batch)
    } catch {
      try {
        await postBatch(batch) // exactly one retry
      } catch {
        // Give up on this batch. Swallowed by design.
      }
    }
  } catch {
    // Belt and suspenders — flush() must never reject into a caller.
  } finally {
    inFlightFlush = false
  }
}

export const analytics = {
  /** Fire a named product event. Never throws. */
  track<K extends keyof AnalyticsEventMap>(
    event: K,
    ...props: AnalyticsEventMap[K] extends Record<string, never> ? [] : [AnalyticsEventMap[K]]
  ): void {
    enqueue(event, props[0] as Record<string, unknown> | undefined)
  },

  /** Screen-view convenience wrapper — always emits `screen_viewed`. */
  screen(name: string, props?: Record<string, unknown>): void {
    enqueue('screen_viewed', { screen_name: name, signed_in: isAuthenticated(), ...(props ?? {}) })
  },

  /** Associates future events with a backend-issued user reference. Must be
   * an opaque id, never a wallet address — `redactProps` also guards this,
   * but callers should still pass e.g. a user id, not an address. */
  identify(userRef: string): void {
    try {
      const cleaned = redactProps({ ref: userRef }).ref
      distinctId = typeof cleaned === 'string' ? cleaned : null
    } catch {
      distinctId = null
    }
  },

  /** Force an immediate best-effort send of whatever is buffered. Safe to
   * call from a background/unmount handler — never throws or blocks. */
  flush(): Promise<void> {
    return flush().catch(() => undefined)
  },
}
