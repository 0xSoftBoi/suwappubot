import { useCallback, useState } from 'react'
import type { MarginMode } from '../types/perps'

// Cross/isolated margin preference, persisted to localStorage so it survives
// reloads. This is a UI preference only — execution stays gated until the
// /webapp/me/perps/margin-mode route exists (see src/lib/perpsApi.ts).

const STORAGE_KEY = 'suwappu_perps_margin_mode'
const DEFAULT_MODE: MarginMode = 'cross'

function loadMode(): MarginMode {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'cross' || stored === 'isolated') return stored
  } catch {
    // ignore (private mode / disabled storage)
  }
  return DEFAULT_MODE
}

export function usePerpsMarginMode(): [MarginMode, (mode: MarginMode) => void] {
  const [mode, setMode] = useState<MarginMode>(loadMode)

  const update = useCallback((next: MarginMode) => {
    setMode(next)
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // ignore
    }
  }, [])

  return [mode, update]
}
