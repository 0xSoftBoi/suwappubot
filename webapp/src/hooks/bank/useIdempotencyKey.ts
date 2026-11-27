import { useCallback, useRef } from 'react'
import { newIdempotencyKey } from '../../lib/bankApi'

/**
 * One idempotency key per user intent. `current()` returns the same key until `reset()`
 * (call reset after a terminal result or when the user edits the inputs), so a retry of the
 * same intent re-sends the same key and can never double-spend.
 */
export function useIdempotencyKey() {
  const ref = useRef<string | null>(null)
  const current = useCallback(() => {
    if (!ref.current) ref.current = newIdempotencyKey()
    return ref.current
  }, [])
  const reset = useCallback(() => {
    ref.current = null
  }, [])
  return { current, reset }
}
