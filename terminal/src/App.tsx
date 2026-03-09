import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { Header } from './components/layout/Header'
import { TradingLayout } from './components/layout/TradingLayout'
import { PointsDashboard } from './components/points/PointsDashboard'
import { HotkeysHelpOverlay } from './components/hotkeys/HotkeysHelpOverlay'

export function App() {
  return (
    <BrowserRouter>
      <div className="h-screen flex flex-col bg-terminal-bg text-terminal-text font-sans">
        <Header />
        <main className="flex-1 overflow-hidden">
          <Routes>
            <Route path="/points" element={<PointsDashboard />} />
            <Route path="*" element={<TradingLayout />} />
          </Routes>
        </main>
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
      </div>
    </BrowserRouter>
  )
}
