import { useState, useEffect } from 'react'

// All persisted keys live under one namespace so they're easy to find/clear.
const NS = 'suwappu:'

export function loadPersisted<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(NS + key)
    return raw !== null ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

export function savePersisted<T>(key: string, value: T): void {
  try {
    localStorage.setItem(NS + key, JSON.stringify(value))
  } catch {
    /* private mode / quota — non-fatal */
  }
}

// useState that survives reloads via localStorage. Drop-in for the bits of UI
// state that should be remembered (pair, mode, chart interval, slippage, …).
export function usePersistentState<T>(key: string, initial: T) {
  const [state, setState] = useState<T>(() => loadPersisted(key, initial))
  useEffect(() => {
    savePersisted(key, state)
  }, [key, state])
  return [state, setState] as const
}
