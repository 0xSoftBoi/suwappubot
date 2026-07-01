import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { Header } from './components/layout/Header'
import { CommandPalette } from './components/command/CommandPalette'
import { MarketRegimeStrip } from './components/market/MarketRegimeStrip'
import { TradingLayout } from './components/layout/TradingLayout'
import { PointsDashboard } from './components/points/PointsDashboard'
import { HotkeysHelpOverlay } from './components/hotkeys/HotkeysHelpOverlay'
import { SuwappuBotSiteReplacement } from './components/templates/SuwappuBotSiteReplacement'
import { TerminalSiteReplacement } from './components/templates/TerminalSiteReplacement'
import { PersimmonStemMotif, SakuraBloomMotif } from './components/brand/PersimmonLogo'
import { TerminalThemeScope } from './theme/TerminalThemeScope'
import { OAuthCallback } from './components/auth/OAuthCallback'
import { AlertSwap } from './routes/AlertSwap'

function isTerminalHost() {
  if (typeof window === 'undefined') return false
  if (window.location.hostname === 'terminal.suwappu.bot') return true
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
  return (
    <TerminalThemeScope mode="summer-breeze">
      <div className="terminal-theme-page relative h-screen overflow-hidden p-1.5 text-terminal-text font-sans md:p-2">
        <div className="pointer-events-none fixed -left-24 top-16 hidden opacity-[0.08] md:block">
          <PersimmonStemMotif size={280} palette="butter" rotation={-18} />
        </div>
        <div className="pointer-events-none fixed right-[-58px] top-20 hidden opacity-[0.1] md:block">
          <SakuraBloomMotif size={190} tone="mist" rotation={24} />
        </div>
        <div className="pointer-events-none fixed bottom-[-96px] right-[20%] hidden opacity-[0.08] md:block">
          <PersimmonStemMotif size={320} palette="butter" rotation={24} flipX />
        </div>

        <div className="relative z-10 mx-auto flex h-full max-w-[1800px] flex-col gap-1.5 md:gap-2">
          <Header />
          <CommandPalette />
          <MarketRegimeStrip />
          <main className="min-h-0 flex-1 overflow-hidden">
            <Routes>
              <Route path="/points" element={<PointsDashboard />} />
              <Route path="points" element={<PointsDashboard />} />
              {/* Price-alert deep link (?alertId=&token=&chain=&side=&amount=&ref=alert).
                  Covers both the primary terminal.suwappu.bot host (pathname
                  "/alert-swap") and the "/terminal/*" dev/proxy mount (pathname
                  "/terminal/alert-swap"). */}
              <Route path="/alert-swap" element={<AlertSwap />} />
              <Route path="alert-swap" element={<AlertSwap />} />
              <Route path="/terminal/alert-swap" element={<AlertSwap />} />
              <Route path="*" element={<TradingLayout />} />
            </Routes>
          </main>
        </div>
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
        <Route path="/auth/callback/:provider" element={<OAuthCallback />} />
        <Route
          path="*"
          element={isTerminalHost() ? (
        <TradingWorkspace />
      ) : (
        <div className="min-h-screen bg-terminal-bg text-terminal-text font-sans">
          <Routes>
            <Route path="/" element={<SuwappuBotSiteReplacement />} />
            <Route path="/terminal-preview" element={<TerminalSiteReplacement />} />
            <Route path="/terminal/*" element={<TradingWorkspace />} />
            <Route path="/points" element={<TradingWorkspace />} />
            <Route path="*" element={<SuwappuBotSiteReplacement />} />
          </Routes>
        </div>
      )}
        />
      </Routes>
      <HotkeysHelpOverlay />
      <Toaster
        position="bottom-right"
        toastOptions={{
          style: {
            background: '#1a1a2e',
            color: '#e2e2f0',
            border: '1px solid #1e1e30',
          },
        }}
      />
    </BrowserRouter>
  )
}
