import { lazy, Suspense, useEffect, type ReactNode } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { Header } from './components/layout/Header'
import { CommandPalette } from './components/command/CommandPalette'
import { MarketRegimeStrip } from './components/market/MarketRegimeStrip'
import { TradingLayout } from './components/layout/TradingLayout'
import { HotkeysHelpOverlay } from './components/hotkeys/HotkeysHelpOverlay'
import { TerminalThemeScope } from './theme/TerminalThemeScope'
import { FirstRunChecklist } from './components/onboarding/FirstRunChecklist'

// The live terminal is the latency-critical entrypoint. Route-only dashboards,
// deep links and the marketing templates should not be parsed before a trader
// can see the chart/orderbook/ticket, so keep them behind route-level chunks.
const PointsDashboard = lazy(() =>
  import('./components/points/PointsDashboard').then((m) => ({ default: m.PointsDashboard })),
)
const SuwappuBotSiteReplacement = lazy(() =>
  import('./components/templates/SuwappuBotSiteReplacement').then((m) => ({
    default: m.SuwappuBotSiteReplacement,
  })),
)
const TerminalSiteReplacement = lazy(() =>
  import('./components/templates/TerminalSiteReplacement').then((m) => ({
    default: m.TerminalSiteReplacement,
  })),
)
const OAuthCallback = lazy(() =>
  import('./components/auth/OAuthCallback').then((m) => ({ default: m.OAuthCallback })),
)
const AlertSwap = lazy(() =>
  import('./routes/AlertSwap').then((m) => ({ default: m.AlertSwap })),
)
const BridgeRoute = lazy(() =>
  import('./routes/BridgeRoute').then((m) => ({ default: m.BridgeRoute })),
)

function DeferredRoute({ children }: { children: ReactNode }) {
  return <Suspense fallback={null}>{children}</Suspense>
}

function isTerminalHost() {
  if (typeof window === 'undefined') return false
  if (
    window.location.hostname === 'terminal.suwappu.bot' ||
    window.location.hostname === 'www.terminal.suwappu.bot'
  ) return true
  // In local dev the terminal is otherwise unreachable: `/` is host-gated to the
  // marketing site and `/terminal` is proxied to the Python API. Treat localhost
  // as the terminal host while developing so the workspace (and its E2E tests)
  // render at `/`. Stripped in production builds where import.meta.env.DEV=false,
  // so the live marketing site at suwappu.bot is unaffected.
  if (import.meta.env.DEV) {
    const { hostname } = window.location
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0'
  }
  return false
}

function TradingWorkspace() {
  // Wallet WebViews do not all implement interactive-widget the same way.
  // visualViewport is the browser's authoritative visible rectangle when the
  // software keyboard/browser chrome changes, so expose it to CSS once here.
  useEffect(() => {
    const viewport = window.visualViewport
    if (!viewport) return

    const root = document.documentElement
    const syncViewport = () => {
      // Min of the three height signals, not visualViewport alone: wallet
      // in-app webviews (Base app, etc.) extend the page under their native
      // bottom bar with viewport-fit=cover and report the full span in
      // visualViewport.height, which pushed the mobile bottom nav into the
      // covered strip. innerHeight/clientHeight are the layout viewport and
      // track the truly visible area in those webviews; in real browsers the
      // three agree (keyboard open: visualViewport is the smallest), so the
      // min never regresses Chrome/Safari.
      const candidates = [viewport.height, window.innerHeight, document.documentElement.clientHeight]
        .filter((v) => Number.isFinite(v) && v > 0)
      const visualHeight = Math.max(1, Math.round(Math.min(...candidates)))
      const occludedBottom =
        viewport.scale === 1
          ? Math.max(0, Math.round(window.innerHeight - viewport.height - viewport.offsetTop))
          : 0
      root.style.setProperty('--terminal-visual-height', `${visualHeight}px`)
      root.style.setProperty('--terminal-keyboard-inset', `${occludedBottom}px`)
    }

    syncViewport()
    viewport.addEventListener('resize', syncViewport, { passive: true })
    viewport.addEventListener('scroll', syncViewport, { passive: true })
    window.addEventListener('resize', syncViewport, { passive: true })

    return () => {
      viewport.removeEventListener('resize', syncViewport)
      viewport.removeEventListener('scroll', syncViewport)
      window.removeEventListener('resize', syncViewport)
      root.style.removeProperty('--terminal-visual-height')
      root.style.removeProperty('--terminal-keyboard-inset')
    }
  }, [])

  // Institutional dark register is now the default theme mode (WS-A). No
  // explicit `mode` prop here — passing "summer-breeze" would override the
  // default and re-light the whole workspace.
  return (
    <TerminalThemeScope>
      <div className="terminal-app-viewport terminal-theme-page relative overflow-hidden text-terminal-text font-sans">
        <div className="relative z-10 mx-auto flex h-full max-w-[1800px] flex-col gap-1.5 md:gap-2">
          <Header />
          <CommandPalette />
          <MarketRegimeStrip />
          <main className="min-h-0 flex-1 overflow-hidden">
            <Routes>
              <Route path="/points" element={<DeferredRoute><PointsDashboard /></DeferredRoute>} />
              <Route path="points" element={<DeferredRoute><PointsDashboard /></DeferredRoute>} />
              {/* Bridge gets its own route rather than a swap-panel tab: it is
                  a different job (moving one token between chains) with a
                  different thing to watch (an in-flight custody window), and
                  folding it into swap is what left it invisible before. Mounted
                  on both the terminal host path and the "/terminal/*" proxy
                  mount, matching the alert-swap deep link above. */}
              <Route path="/bridge" element={<DeferredRoute><BridgeRoute /></DeferredRoute>} />
              <Route path="bridge" element={<DeferredRoute><BridgeRoute /></DeferredRoute>} />
              <Route path="/terminal/bridge" element={<DeferredRoute><BridgeRoute /></DeferredRoute>} />
              {/* Price-alert deep link (?alertId=&token=&chain=&side=&amount=&ref=alert).
                  Covers both the primary terminal.suwappu.bot host (pathname
                  "/alert-swap") and the "/terminal/*" dev/proxy mount (pathname
                  "/terminal/alert-swap"). */}
              <Route path="/alert-swap" element={<DeferredRoute><AlertSwap /></DeferredRoute>} />
              <Route path="alert-swap" element={<DeferredRoute><AlertSwap /></DeferredRoute>} />
              <Route path="/terminal/alert-swap" element={<DeferredRoute><AlertSwap /></DeferredRoute>} />
              <Route path="*" element={<TradingLayout />} />
            </Routes>
          </main>
        </div>
        <FirstRunChecklist />
      </div>
    </TerminalThemeScope>
  )
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* OAuth provider landing — must win over host-based branching so the
            callback forwards to the backend regardless of which origin (terminal
            or root) the oauth_redirect_base allowlist points Google back to. */}
        <Route path="/auth/callback/:provider" element={<DeferredRoute><OAuthCallback /></DeferredRoute>} />
        <Route
          path="*"
          element={isTerminalHost() ? (
        <TradingWorkspace />
      ) : (
        <div className="min-h-screen bg-terminal-bg text-terminal-text font-sans">
          <Routes>
            <Route path="/" element={<DeferredRoute><SuwappuBotSiteReplacement /></DeferredRoute>} />
            <Route path="/terminal-preview" element={<DeferredRoute><TerminalSiteReplacement /></DeferredRoute>} />
            <Route path="/terminal/*" element={<TradingWorkspace />} />
            <Route path="/points" element={<TradingWorkspace />} />
            <Route path="*" element={<DeferredRoute><SuwappuBotSiteReplacement /></DeferredRoute>} />
          </Routes>
        </div>
      )}
        />
      </Routes>
      <HotkeysHelpOverlay />
      <Toaster
        position="bottom-right"
        containerClassName="terminal-toast-container"
        toastOptions={{
          style: {
            background: 'rgb(var(--terminal-c-panel))',
            color: 'rgb(var(--terminal-c-text))',
            border: '1px solid var(--terminal-hairline-strong)',
          },
        }}
      />
    </BrowserRouter>
  )
}
