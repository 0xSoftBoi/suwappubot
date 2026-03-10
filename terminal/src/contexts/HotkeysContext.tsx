import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from 'react'
import { useBottomTab } from './BottomTabContext'
import { useTrading } from './TradingContext'

interface HotkeyEntry {
  key: string
  label: string
  category: string
  action: () => void
}

interface HotkeysContextType {
  showHelp: boolean
  setShowHelp: (show: boolean) => void
  toggleHelp: () => void
  registerHotkey: (id: string, entry: HotkeyEntry) => void
  unregisterHotkey: (id: string) => void
  hotkeys: Map<string, HotkeyEntry>
}

const HotkeysContext = createContext<HotkeysContextType | undefined>(undefined)

// Default hotkey definitions (labels only — actions are registered at runtime)
const DEFAULT_HOTKEY_DEFS: { key: string; label: string; category: string }[] = [
  { key: 'b', label: 'Focus Buy / Swap Input', category: 'Trading' },
  { key: 's', label: 'Focus Sell Input', category: 'Trading' },
  { key: 'Escape', label: 'Close Modal / Dropdown', category: 'Navigation' },
  { key: 'Ctrl+K', label: 'Open Pair Search', category: 'Navigation' },
  { key: '1', label: '1m Chart Interval', category: 'Chart' },
  { key: '2', label: '5m Chart Interval', category: 'Chart' },
  { key: '3', label: '15m Chart Interval', category: 'Chart' },
  { key: '4', label: '1H Chart Interval', category: 'Chart' },
  { key: '5', label: '4H Chart Interval', category: 'Chart' },
  { key: '6', label: '1D Chart Interval', category: 'Chart' },
  { key: 'f', label: 'Toggle Fullscreen Chart', category: 'Chart' },
  { key: 'p', label: 'Portfolio Tab', category: 'Navigation' },
  { key: 'd', label: 'Discovery Tab', category: 'Navigation' },
  { key: 't', label: 'Tweets Tab', category: 'Navigation' },
  { key: 'w', label: 'Wallet Tracker Tab', category: 'Navigation' },
  { key: '?', label: 'Show Hotkeys Help', category: 'Navigation' },
]

export function HotkeysProvider({ children }: { children: ReactNode }) {
  const [showHelp, setShowHelp] = useState(false)
  const hotkeysRef = useRef<Map<string, HotkeyEntry>>(new Map())
  const [, forceUpdate] = useState(0)
  const { setActiveTab } = useBottomTab()
  const { buyInputRef, sellInputRef, setChartInterval, toggleChartFullscreen } = useTrading()

  const toggleHelp = useCallback(() => {
    setShowHelp(prev => !prev)
  }, [])

  const registerHotkey = useCallback((id: string, entry: HotkeyEntry) => {
    hotkeysRef.current.set(id, entry)
    forceUpdate(n => n + 1)
  }, [])

  const unregisterHotkey = useCallback((id: string) => {
    hotkeysRef.current.delete(id)
    forceUpdate(n => n + 1)
  }, [])

  // Register built-in tab-switching and help hotkeys
  useEffect(() => {
    const builtins: [string, HotkeyEntry][] = [
      ['tab-portfolio', { key: 'p', label: 'Portfolio Tab', category: 'Navigation', action: () => setActiveTab('portfolio') }],
      ['tab-discovery', { key: 'd', label: 'Discovery Tab', category: 'Navigation', action: () => setActiveTab('discovery') }],
      ['tab-tweets', { key: 't', label: 'Tweets Tab', category: 'Navigation', action: () => setActiveTab('tweets') }],
      ['tab-wallet-tracker', { key: 'w', label: 'Wallet Tracker Tab', category: 'Navigation', action: () => setActiveTab('wallet-tracker') }],
      ['help-toggle', { key: '?', label: 'Show Hotkeys Help', category: 'Navigation', action: () => toggleHelp() }],
    ]
    for (const [id, entry] of builtins) {
      hotkeysRef.current.set(id, entry)
    }
    forceUpdate(n => n + 1)
    return () => {
      for (const [id] of builtins) {
        hotkeysRef.current.delete(id)
      }
    }
  }, [setActiveTab, toggleHelp])

  // Register trading hotkeys: B (buy), S (sell), F (fullscreen), 1-6 (intervals)
  useEffect(() => {
    const intervalMap: [string, string, string][] = [
      ['chart-1m', '1', '1m'],
      ['chart-5m', '2', '5m'],
      ['chart-15m', '3', '15m'],
      ['chart-1h', '4', '1h'],
      ['chart-4h', '5', '4h'],
      ['chart-1d', '6', '1D'],
    ]

    const tradingKeys: [string, HotkeyEntry][] = [
      ['focus-buy', {
        key: 'b',
        label: 'Focus Buy / Swap Input',
        category: 'Trading',
        action: () => buyInputRef.current?.focus(),
      }],
      ['focus-sell', {
        key: 's',
        label: 'Focus Sell Input',
        category: 'Trading',
        action: () => sellInputRef.current?.focus(),
      }],
      ['chart-fullscreen', {
        key: 'f',
        label: 'Toggle Fullscreen Chart',
        category: 'Chart',
        action: () => toggleChartFullscreen(),
      }],
      ...intervalMap.map(([id, key, interval]): [string, HotkeyEntry] => [
        id,
        {
          key,
          label: `${interval} Chart Interval`,
          category: 'Chart',
          action: () => setChartInterval(interval as '1m' | '5m' | '15m' | '1h' | '4h' | '1D'),
        },
      ]),
    ]

    for (const [id, entry] of tradingKeys) {
      hotkeysRef.current.set(id, entry)
    }
    forceUpdate(n => n + 1)

    return () => {
      for (const [id] of tradingKeys) {
        hotkeysRef.current.delete(id)
      }
    }
  }, [buyInputRef, sellInputRef, setChartInterval, toggleChartFullscreen])

  // Global keydown listener
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      const tagName = target.tagName.toLowerCase()

      // Escape always works (close modals)
      if (e.key === 'Escape') {
        if (showHelp) {
          setShowHelp(false)
          return
        }
        // Dispatch to any registered Escape handlers
        for (const entry of hotkeysRef.current.values()) {
          if (entry.key === 'Escape') entry.action()
        }
        return
      }

      // Ignore all other hotkeys when focused on form elements
      if (tagName === 'input' || tagName === 'textarea' || tagName === 'select' || target.isContentEditable) {
        return
      }

      // ? key (Shift+/ on US keyboards or literally ?)
      if (e.key === '?') {
        e.preventDefault()
        toggleHelp()
        return
      }

      // Look up registered hotkeys by key
      const key = e.key.toLowerCase()
      for (const entry of hotkeysRef.current.values()) {
        if (entry.key.toLowerCase() === key) {
          e.preventDefault()
          entry.action()
          return
        }
      }
    }

    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [showHelp, toggleHelp])

  return (
    <HotkeysContext.Provider
      value={{
        showHelp,
        setShowHelp,
        toggleHelp,
        registerHotkey,
        unregisterHotkey,
        hotkeys: hotkeysRef.current,
      }}
    >
      {children}
    </HotkeysContext.Provider>
  )
}

export function useHotkeys(): HotkeysContextType {
  const context = useContext(HotkeysContext)
  if (!context) throw new Error('useHotkeys must be used within HotkeysProvider')
  return context
}

export { DEFAULT_HOTKEY_DEFS }
