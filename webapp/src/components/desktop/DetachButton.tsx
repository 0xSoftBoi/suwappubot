import { useState } from 'react'

const isDesktop = !!(
  typeof window !== 'undefined' &&
  (window as any).__SUWAPPU_DESKTOP__?.isDesktop
)

interface DetachButtonProps {
  panelId: string
  className?: string
}

export function DetachButton({ panelId, className }: DetachButtonProps) {
  const [opening, setOpening] = useState(false)

  if (!isDesktop) return null

  // Don't show in detached windows
  if ((window as any).__SUWAPPU_DESKTOP__?.isDetached) return null

  const handleDetach = async () => {
    const bridge = (window as any).__SUWAPPU_DESKTOP__
    if (!bridge?.openWindow) return

    setOpening(true)
    try {
      await bridge.openWindow(panelId)
    } catch (err) {
      console.error('[DetachButton] Failed to open window:', err)
    } finally {
      setOpening(false)
    }
  }

  return (
    <button
      onClick={handleDetach}
      disabled={opening}
      title="Open in new window"
      className={
        className ||
        'inline-flex items-center justify-center w-6 h-6 text-suwappu-text-muted hover:text-suwappu-text-secondary rounded transition-colors disabled:opacity-50'
      }
    >
      <svg
        className="w-3.5 h-3.5"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
        />
      </svg>
    </button>
  )
}
