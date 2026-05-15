import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { Header } from './components/layout/Header'
import { TradingLayout } from './components/layout/TradingLayout'
import { PointsDashboard } from './components/points/PointsDashboard'
import { HotkeysHelpOverlay } from './components/hotkeys/HotkeysHelpOverlay'
import { SuwappuBotSiteReplacement } from './components/templates/SuwappuBotSiteReplacement'
import { TerminalSiteReplacement } from './components/templates/TerminalSiteReplacement'
import { PersimmonStemMotif, SakuraBloomMotif } from './components/brand/PersimmonLogo'
import { TerminalThemeScope } from './theme/TerminalThemeScope'

function isTerminalHost() {
  if (typeof window === 'undefined') return false
  return window.location.hostname === 'terminal.suwappu.bot'
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
          <main className="min-h-0 flex-1 overflow-hidden">
            <Routes>
              <Route path="/points" element={<PointsDashboard />} />
              <Route path="points" element={<PointsDashboard />} />
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
