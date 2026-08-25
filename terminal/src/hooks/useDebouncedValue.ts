import { useEffect, useState } from 'react'

// Shared debounce, matching the delay Curve's and Balancer's search boxes
// already use — a value settles 350ms after the last change before the
// query key it feeds into actually changes.
export function useDebouncedValue<T>(value: T, delayMs = 350): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timeout = window.setTimeout(() => setDebounced(value), delayMs)
    return () => window.clearTimeout(timeout)
  }, [value, delayMs])
  return debounced
}
