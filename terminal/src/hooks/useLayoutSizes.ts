import { useState, useCallback, useRef } from 'react'

const STORAGE_KEY = 'suwappu_terminal_layout'

interface LayoutSizes {
  top: number
  bottom: number
  chart: number
  orderbook: number
  order: number
}

const DEFAULT_SIZES: LayoutSizes = {
  top: 600,
  bottom: 250,
  chart: 600,
  orderbook: 280,
  order: 380,
}

function loadSizes(): LayoutSizes {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) return { ...DEFAULT_SIZES, ...JSON.parse(stored) }
  } catch {
    // ignore
  }
  return DEFAULT_SIZES
}

export function useLayoutSizes() {
  const [sizes, setSizes] = useState<LayoutSizes>(loadSizes)
  const saveTimeout = useRef<ReturnType<typeof setTimeout>>()

  const save = useCallback((next: LayoutSizes) => {
    if (saveTimeout.current) clearTimeout(saveTimeout.current)
    saveTimeout.current = setTimeout(() => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    }, 500)
  }, [])

  const onSizesChange = {
    vertical: useCallback((values: number[]) => {
      if (values.length >= 2) {
        const next = { ...sizes, top: values[0], bottom: values[1] }
        setSizes(next)
        save(next)
      }
    }, [sizes, save]),
    horizontal: useCallback((values: number[]) => {
      if (values.length >= 3) {
        const next = { ...sizes, chart: values[0], orderbook: values[1], order: values[2] }
        setSizes(next)
        save(next)
      } else if (values.length >= 2) {
        const next = { ...sizes, chart: values[0], order: values[1] }
        setSizes(next)
        save(next)
      }
    }, [sizes, save]),
  }

  return { sizes, onSizesChange }
}
