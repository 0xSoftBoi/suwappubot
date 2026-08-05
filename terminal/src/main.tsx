import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
// wagmi + RainbowKit are mounted inside AuthProvider (see AuthContext) so the
// wallet-connect feature is self-contained. They must NOT be mounted here too —
// a second WagmiProvider/RainbowKitProvider would nest providers.
import { AuthProvider } from './contexts/AuthContext'
import { BottomTabProvider } from './contexts/BottomTabContext'
import { HotkeysProvider } from './contexts/HotkeysContext'
import { TradingProvider } from './contexts/TradingContext'
import { PairProvider } from './contexts/PairContext'
import { ErrorBoundary } from './components/ErrorBoundary'
import { App } from './App'
import { initPostHog } from './lib/posthog'
import './index.css'

initPostHog()

// Dev-only API fixtures for screenshots / design work (VITE_MOCK=1). No-op in prod.
if (import.meta.env.DEV && import.meta.env.VITE_MOCK) {
  const { installDevMock } = await import('./lib/devMock')
  installDevMock()
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <PairProvider>
          <BottomTabProvider>
            <TradingProvider>
              <HotkeysProvider>
                <ErrorBoundary>
                  <App />
                </ErrorBoundary>
              </HotkeysProvider>
            </TradingProvider>
          </BottomTabProvider>
        </PairProvider>
      </AuthProvider>
    </QueryClientProvider>
  </React.StrictMode>,
)
