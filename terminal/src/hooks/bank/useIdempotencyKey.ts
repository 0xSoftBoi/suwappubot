import { useCallback, useMemo, useRef } from 'react'
import { BankApiError, newIdempotencyKey } from '../../lib/bankApi'
import { clearIntentKey, intentKey } from './intentKey'

/** cyrb53: short stable hash so the fingerprint (which may contain names / amounts) is not stored as a storage key verbatim. */
function hash(s: string): string {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 2654435761)
    h2 = Math.imul(h2 ^ c, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}

/** A request the server definitively rejected (the money did not move): the next attempt is a new intent. */
export function isDefinitiveFailure(err: unknown): boolean {
  return err instanceof BankApiError && err.status >= 400 && err.status < 500 && ![408, 409, 425, 429].includes(err.status)
}

/**
 * One idempotency key per user intent. `current()` returns the same key until `reset()` (success, or the
 * user edits the inputs) or `settle(err)` (a definitive server rejection), so a retry of the same intent
 * re-sends the same key and cannot double-send.
 *
 * Without `fingerprint` the key lives in the component (survives while the page stays mounted).
 * With a `fingerprint` of the intent (action + accounts + amount + recipient) the key is also kept in
 * sessionStorage for 30 minutes, so closing and reopening a confirm sheet after an ambiguous failure
 * (timeout) re-sends the SAME key; changing any input changes the fingerprint and therefore the key.
 */
export function useIdempotencyKey(fingerprint?: string) {
  const ref = useRef<string | null>(null)
  const fp = useRef<string | undefined>(fingerprint)
  fp.current = fingerprint === undefined ? undefined : hash(fingerprint)
  const current = useCallback(() => {
    if (fp.current !== undefined) return intentKey(fp.current)
    if (!ref.current) ref.current = newIdempotencyKey()
    return ref.current
  }, [])
  const reset = useCallback(() => {
    ref.current = null
    if (fp.current !== undefined) clearIntentKey(fp.current)
  }, [])
  const settle = useCallback((err: unknown) => { if (isDefinitiveFailure(err)) reset() }, [reset])
  return useMemo(() => ({ current, reset, settle }), [current, reset, settle])
}
