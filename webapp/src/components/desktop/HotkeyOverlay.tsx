import { useEffect, useState, useCallback } from 'react'

interface HotkeyEntry {
  keys: string
  description: string
}

interface HotkeySection {
  title: string
  entries: HotkeyEntry[]
}

const isMac =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
const modKey = isMac ? '\u2318' : 'Ctrl'

const IN_APP_SHORTCUTS: HotkeyEntry[] = [
  { keys: `${modKey}+K`, description: 'Search / command palette' },
  { keys: `${modKey}+1`, description: 'Home' },
  { keys: `${modKey}+2`, description: 'Swap' },
  { keys: `${modKey}+3`, description: 'Wallet' },
  { keys: `${modKey}+4`, description: 'Portfolio' },
  { keys: `${modKey}+5`, description: 'History' },
  { keys: `${modKey}+6`, description: 'Alerts' },
  { keys: `${modKey}+7`, description: 'Copy Trade' },
  { keys: `${modKey}+8`, description: 'Settings' },
  { keys: `${modKey}+Enter`, description: 'Confirm current action' },
  { keys: 'Esc', description: 'Close modal / overlay' },
]

function formatAccelerator(accel: string): string {
  return accel
    .replace(/CmdOrCtrl/g, modKey)
    .replace(/CommandOrControl/g, modKey)
    .replace(/Cmd/g, '\u2318')
    .replace(/Ctrl/g, 'Ctrl')
    .replace(/Shift/g, '\u21E7')
    .replace(/Alt/g, isMac ? '\u2325' : 'Alt')
    .replace(/\+/g, ' + ')
}

function KeyCombo({ keys }: { keys: string }) {
  const parts = keys.split('+').map((p) => p.trim())

  return (
    <span className="inline-flex items-center gap-1">
      {parts.map((part, i) => (
        <kbd
          key={i}
          className="inline-flex items-center justify-center min-w-[28px] h-7 px-1.5 rounded-md bg-white/10 border border-white/20 text-xs font-mono font-medium text-white/90 shadow-sm"
        >
          {part}
        </kbd>
      ))}
    </span>
  )
}

export function HotkeyOverlay() {
  const [visible, setVisible] = useState(false)
  const [globalBindings, setGlobalBindings] = useState<HotkeyEntry[]>([])

  const close = useCallback(() => setVisible(false), [])
  const open = useCallback(() => setVisible(true), [])

  // Load global hotkey bindings from desktop bridge
  useEffect(() => {
    async function load() {
      const bridge = (window as any).__SUWAPPU_DESKTOP__
      if (bridge?.hotkeys?.list) {
        try {
          const bindings = await bridge.hotkeys.list()
          setGlobalBindings(
            bindings.map((b: any) => ({
              keys: formatAccelerator(b.accelerator),
              description: b.description,
            }))
          )
        } catch {
          // Fall back to static list if RPC fails
          setGlobalBindings(getDefaultGlobalBindings())
        }
      } else {
        setGlobalBindings(getDefaultGlobalBindings())
      }
    }
    load()
  }, [visible])

  // Listen for global hotkey trigger and close-overlay event
  useEffect(() => {
    function handleHotkey(e: Event) {
      const detail = (e as CustomEvent).detail
      if (detail?.action === 'show-hotkey-help') {
        setVisible((v) => !v)
      }
    }

    function handleClose() {
      setVisible(false)
    }

    window.addEventListener('suwappu:hotkey', handleHotkey)
    window.addEventListener('suwappu:close-overlay', handleClose)

    return () => {
      window.removeEventListener('suwappu:hotkey', handleHotkey)
      window.removeEventListener('suwappu:close-overlay', handleClose)
    }
  }, [])

  if (!visible) return null

  const sections: HotkeySection[] = [
    { title: 'Global Hotkeys', entries: globalBindings },
    { title: 'In-App Shortcuts', entries: IN_APP_SHORTCUTS },
  ]

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      onClick={close}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      {/* Content */}
      <div
        className="relative w-full max-w-xl max-h-[80vh] mx-4 rounded-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <h2 className="text-lg font-semibold text-white">
            Keyboard Shortcuts
          </h2>
          <button
            onClick={close}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-white/50 hover:text-white hover:bg-white/10 transition-colors"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto px-6 py-4" style={{ maxHeight: 'calc(80vh - 64px)' }}>
          {sections.map((section) => (
            <div key={section.title} className="mb-6 last:mb-0">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-purple-400 mb-3">
                {section.title}
              </h3>
              <div className="space-y-2">
                {section.entries.map((entry, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-white/5 transition-colors"
                  >
                    <span className="text-sm text-white/80">
                      {entry.description}
                    </span>
                    <KeyCombo keys={entry.keys} />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Footer hint */}
        <div className="px-6 py-3 border-t border-white/10 text-center">
          <span className="text-xs text-white/40">
            Press <kbd className="px-1.5 py-0.5 rounded bg-white/10 border border-white/20 text-white/60 font-mono">Esc</kbd> to close
          </span>
        </div>
      </div>
    </div>
  )
}

function getDefaultGlobalBindings(): HotkeyEntry[] {
  return [
    { keys: formatAccelerator('CmdOrCtrl+Shift+S'), description: 'Open quick swap panel' },
    { keys: formatAccelerator('CmdOrCtrl+Shift+P'), description: 'Panic sell — emergency sell all positions' },
    { keys: formatAccelerator('CmdOrCtrl+Shift+K'), description: 'Quick token search' },
    { keys: formatAccelerator('CmdOrCtrl+Shift+L'), description: 'Toggle launch scanner feed' },
    { keys: formatAccelerator('CmdOrCtrl+Shift+T'), description: 'Toggle always-on-top price ticker' },
    { keys: formatAccelerator('CmdOrCtrl+Shift+A'), description: 'Toggle alerts panel' },
    { keys: formatAccelerator('CmdOrCtrl+Shift+C'), description: 'Toggle copy trading' },
    { keys: formatAccelerator('CmdOrCtrl+Shift+F'), description: 'Focus token search' },
    { keys: formatAccelerator('CmdOrCtrl+?'), description: 'Show keyboard shortcuts' },
  ]
}
