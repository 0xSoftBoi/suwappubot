import { useEffect } from 'react'
import { useTelegram } from './hooks/useTelegram'
import { Portfolio } from './components/Portfolio'
import { SwapHistory } from './components/SwapHistory'
import { Navigation } from './components/Navigation'
import { useState } from 'react'

type Tab = 'portfolio' | 'history'

function App() {
  const { webApp, user, isReady, colorScheme } = useTelegram()
  const [activeTab, setActiveTab] = useState<Tab>('portfolio')

  useEffect(() => {
    // Sync theme with Telegram
    if (colorScheme === 'dark') {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
  }, [colorScheme])

  useEffect(() => {
    // Expand the webapp to full height
    if (webApp) {
      webApp.expand()
      webApp.ready()
    }
  }, [webApp])

  if (!isReady) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-tg-bg">
        <div className="animate-pulse text-tg-hint">Loading...</div>
      </div>
    )
  }

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-tg-bg p-4">
        <div className="text-center">
          <h1 className="text-xl font-bold text-tg-text mb-2">Suwappu</h1>
          <p className="text-tg-hint">Please open this app from Telegram</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-tg-bg flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-tg-bg border-b border-tg-secondary px-4 py-3">
        <div className="flex items-center gap-3">
          {user.photo_url && (
            <img
              src={user.photo_url}
              alt={user.first_name}
              className="w-10 h-10 rounded-full"
            />
          )}
          <div>
            <h1 className="font-semibold text-tg-text">
              {user.first_name} {user.last_name || ''}
            </h1>
            <p className="text-sm text-tg-hint">@{user.username || 'user'}</p>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 overflow-auto pb-20">
        {activeTab === 'portfolio' && <Portfolio />}
        {activeTab === 'history' && <SwapHistory />}
      </main>

      {/* Bottom Navigation */}
      <Navigation activeTab={activeTab} onTabChange={setActiveTab} />
    </div>
  )
}

export default App
