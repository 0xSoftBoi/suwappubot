import { useEffect, useRef } from 'react'
import { useHotkeys, DEFAULT_HOTKEY_DEFS } from '../../contexts/HotkeysContext'

const CATEGORIES = ['Navigation', 'Trading', 'Chart'] as const

function KeyBadge({ label }: { label: string }) {
  return (
    <kbd className="inline-flex items-center justify-center min-w-[24px] h-6 px-1.5 rounded
                     bg-terminal-bg border border-terminal-border-active
                     text-xs font-mono text-terminal-text font-medium">
      {label}
    </kbd>
  )
}

export function HotkeysHelpOverlay() {
  const { showHelp, setShowHelp } = useHotkeys()
  const overlayRef = useRef<HTMLDivElement>(null)

  // Close on click outside
  useEffect(() => {
    if (!showHelp) return
    const handler = (e: MouseEvent) => {
      if (overlayRef.current && !overlayRef.current.contains(e.target as Node)) {
        setShowHelp(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showHelp, setShowHelp])

  if (!showHelp) return null

  const grouped = CATEGORIES.map(cat => ({
    category: cat,
    items: DEFAULT_HOTKEY_DEFS.filter(h => h.category === cat),
  }))

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      data-testid="hotkeys-overlay"
    >
      <div
        ref={overlayRef}
        className="w-full max-w-md mx-4 bg-terminal-panel border border-terminal-border rounded-lg shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-terminal-border">
          <h2 className="text-base font-semibold text-terminal-text">Keyboard Shortcuts</h2>
          <button
            onClick={() => setShowHelp(false)}
            className="text-terminal-text-muted hover:text-terminal-text transition-colors"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 max-h-[60vh] overflow-y-auto">
          {grouped.map(group => (
            <div key={group.category} className="mb-5 last:mb-0">
              <h3 className="text-xs font-semibold text-sakura-400 uppercase tracking-wider mb-2">
                {group.category}
              </h3>
              <div className="space-y-1.5">
                {group.items.map(item => (
                  <div
                    key={item.key}
                    className="flex items-center justify-between py-1"
                  >
                    <span className="text-sm text-terminal-text-secondary">{item.label}</span>
                    <KeyBadge label={item.key.length === 1 ? item.key.toUpperCase() : item.key} />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-5 py-2.5 border-t border-terminal-border">
          <p className="text-xs text-terminal-text-muted text-center">
            Press <KeyBadge label="?" /> to toggle &middot; <KeyBadge label="Esc" /> to close
          </p>
        </div>
      </div>
    </div>
  )
}
