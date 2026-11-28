import { newIdempotencyKey } from '../../lib/bankApi'

/**
 * Idempotency key per money intent, kept in sessionStorage under a fingerprint of the intent
 * (action + accounts + amount + recipient). Closing and reopening a confirm sheet for the SAME
 * intent re-sends the same key, so an ambiguous failure (timeout) cannot double-spend; changing
 * any input changes the fingerprint and therefore the key. Call `clearIntentKey` after a terminal
 * success. Entries expire after 30 minutes.
 */
const TTL_MS = 30 * 60_000
const PREFIX = 'bank-intent:'

type Entry = { k: string; t: number }
const mem = new Map<string, Entry>()

function read(fp: string): Entry | null {
  const hit = mem.get(fp)
  if (hit) return hit
  try {
    const raw = sessionStorage.getItem(PREFIX + fp)
    if (raw) return JSON.parse(raw) as Entry
  } catch { /* storage unavailable: memory only */ }
  return null
}

export function intentKey(fp: string): string {
  const now = Date.now()
  const e = read(fp)
  if (e && typeof e.k === 'string' && now - e.t < TTL_MS) return e.k
  const fresh: Entry = { k: newIdempotencyKey(), t: now }
  mem.set(fp, fresh)
  try { sessionStorage.setItem(PREFIX + fp, JSON.stringify(fresh)) } catch { /* ignore */ }
  return fresh.k
}

export function clearIntentKey(fp: string): void {
  mem.delete(fp)
  try { sessionStorage.removeItem(PREFIX + fp) } catch { /* ignore */ }
}
