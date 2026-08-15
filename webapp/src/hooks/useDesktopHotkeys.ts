import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

const isDesktop = !!(
  typeof window !== 'undefined' &&
  (window as any).__SUWAPPU_DESKTOP__?.isDesktop
)

/**
 * In-app keyboard shortcuts for the desktop build.
 *
 * These use standard DOM keyboard events (not Electrobun global shortcuts)
 * and only activate when running inside the desktop shell.
 *
 * Shortcuts:
 *   Cmd/Ctrl+K        → Focus search / command palette
 *   Cmd/Ctrl+1..8     → Switch sidebar tabs
 *   Cmd/Ctrl+Enter    → Confirm current action
 *   Escape            → Close current modal/overlay
 */

const TAB_ROUTES = [
  '/home',       // 1
  '/swap',       // 2
  '/wallet',     // 3
  '/portfolio',  // 4
  '/history',    // 5
  '/alerts',     // 6
  '/copy',       // 7
  '/settings',   // 8
]

export function useDesktopHotkeys() {
  const navigate = useNavigate()

  useEffect(() => {
    if (!isDesktop) return

    function handleKeyDown(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey

      // Cmd/Ctrl+K → Focus search / command palette
      if (meta && e.key === 'k') {
        e.preventDefault()
        window.dispatchEvent(
          new CustomEvent('suwappu:hotkey', { detail: { action: 'focus-search' } })
        )
        return
      }

      // Cmd/Ctrl+1 through Cmd/Ctrl+8 → Switch sidebar tabs
      if (meta && e.key >= '1' && e.key <= '8') {
        e.preventDefault()
        const index = parseInt(e.key, 10) - 1
        const route = TAB_ROUTES[index]
        if (route) navigate(route)
        return
      }

      // Cmd/Ctrl+Enter → Confirm current action
      if (meta && e.key === 'Enter') {
        e.preventDefault()
        window.dispatchEvent(
          new CustomEvent('suwappu:confirm-action')
        )
        return
      }

      // Escape → Close current modal/overlay
      if (e.key === 'Escape') {
        window.dispatchEvent(
          new CustomEvent('suwappu:close-overlay')
        )
        return
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [navigate])
}
