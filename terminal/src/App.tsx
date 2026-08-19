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

const PointsDashboard = lazy(() => import('./components/points/PointsDashboard').then((m) => ({ default: m.PointsDashboard })))
const SuwappuBotSiteReplacement = lazy(() => import('./components/templates/SuwappuBotSiteReplacement').then((m) => ({ default: m.SuwappuBotSiteReplacement })))
const TerminalSiteReplacement = lazy(() => import('./components/templates/TerminalSiteReplacement').then((m) => ({ default: m.TerminalSiteReplacement })))
const OAuthCallback = lazy(() => import('./components/auth/OAuthCallback').then((m) => ({ default: m.OAuthCallback })))
const AlertSwap = lazy(() => import('./routes/AlertSwap').then((m) => ({ default: m.AlertSwap })))
const BridgeRoute = lazy(() => import('./routes/BridgeRoute').then((m) => ({ default: m.BridgeRoute })))
const SignalDashboard = lazy(() => import('./routes/SignalDashboard').then((m) => ({ default: m.SignalDashboard })))

function DeferredRoute({ children }: { children: ReactNode }) {
  return <Suspense fallback={null}>{children}</Suspense>
}

function isTerminalHost() {
  if (typeof window === 'undefined') return false
  if (window.location.hostname === 'terminal.suwappu.bot') return true
  if (import.meta.env.DEV) {
    const { hostname } = window.location
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0'
  }
  return false
}

function TradingWorkspace() {
  useEffect(() => {
    const viewport = window.visualViewport
    if (!viewport) return
    const root = document.documentElement
    const syncViewport = () => {
      const visualHeight = Math.max(1, Math.round(viewport.height))
      const occludedBottom = viewport.scale === 1 ? Math.max(0, Math.round(window.innerHeight - viewport.height - viewport.offsetTop)) : 0
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
              <Route path="/bridge" element={<DeferredRoute><BridgeRoute /></DeferredRoute>} />
              <Route path="bridge" element={<DeferredRoute><BridgeRoute /></DeferredRoute>} />
              <Route path="/terminal/bridge" element={<DeferredRoute><BridgeRoute /></DeferredRoute>} />
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
        <Route path="/auth/callback/:provider" element={<DeferredRoute><OAuthCallback /></DeferredRoute>} />
        <Route path="/signals/*" element={<DeferredRoute><SignalDashboard /></DeferredRoute>} />
        <Route path="/research/signals/*" element={<DeferredRoute><SignalDashboard /></DeferredRoute>} />
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
        toastOptions={{ style: { background: 'rgb(var(--terminal-c-panel))', color: 'rgb(var(--terminal-c-text))', border: '1px solid var(--terminal-hairline-strong)' } }}
      />
    </BrowserRouter>
  )
}
