import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { WagmiProvider } from 'wagmi'
import { RainbowKitProvider, darkTheme } from '@rainbow-me/rainbowkit'
import '@rainbow-me/rainbowkit/styles.css'
import { config as wagmiConfig } from './lib/wagmi'
import { AuthProvider } from './contexts/AuthContext'
import { BottomTabProvider } from './contexts/BottomTabContext'
import { HotkeysProvider } from './contexts/HotkeysContext'
import { TradingProvider } from './contexts/TradingContext'
import { PairProvider } from './contexts/PairContext'
import { ErrorBoundary } from './components/ErrorBoundary'
import { App } from './App'
import './index.css'

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
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider theme={darkTheme({ accentColor: '#ec4899', borderRadius: 'small' })}>
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
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  </React.StrictMode>,
)
