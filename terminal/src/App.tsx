import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { Header } from './components/layout/Header'
import { TradingLayout } from './components/layout/TradingLayout'
import { PointsDashboard } from './components/points/PointsDashboard'
import { HotkeysHelpOverlay } from './components/hotkeys/HotkeysHelpOverlay'
import { SuwappuBotSiteReplacement } from './components/templates/SuwappuBotSiteReplacement'
import { TerminalSiteReplacement } from './components/templates/TerminalSiteReplacement'
import { TerminalThemeScope } from './theme/TerminalThemeScope'

function isTerminalHost() {
  if (typeof window === 'undefined') return false
  return window.location.hostname === 'terminal.suwappu.bot'
}

function TradingWorkspace() {
  return (
    <TerminalThemeScope mode="summer-breeze">
      <div className="h-screen flex flex-col bg-terminal-bg text-terminal-text font-sans">
        <Header />
        <main className="flex-1 overflow-hidden">
          <Routes>
            <Route path="/points" element={<PointsDashboard />} />
            <Route path="points" element={<PointsDashboard />} />
            <Route path="*" element={<TradingLayout />} />
          </Routes>
        </main>
      </div>
    </TerminalThemeScope>
  )
}

export function App() {
  return (
    <BrowserRouter>
      {isTerminalHost() ? (
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
