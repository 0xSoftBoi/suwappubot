/**
 * TON Connect integration for the Telegram Mini App.
 *
 * Provides TON wallet connection via the TON Connect protocol.
 * Uses @tonconnect/ui-react for the standard wallet connection UI.
 *
 * The TonConnectUIProvider must be installed as a dependency:
 *   npm install @tonconnect/ui-react
 */

import { createContext, useContext, useMemo, type ReactNode } from 'react'

// TON Connect types — will be available after installing @tonconnect/ui-react
// For now, provide a lightweight wrapper that can be used conditionally

interface TonWallet {
  address: string
  chain: string // "-239" for mainnet, "-3" for testnet
  publicKey?: string
}

interface TonConnectContextType {
  /** Whether TON Connect SDK is available (package installed) */
  isAvailable: boolean
  /** Connected TON wallet info */
  wallet: TonWallet | null
  /** Whether a wallet is connected */
  isConnected: boolean
  /** Connect a TON wallet (opens modal) */
  connect: () => void
  /** Disconnect the current wallet */
  disconnect: () => void
}

const TonConnectContext = createContext<TonConnectContextType>({
  isAvailable: false,
  wallet: null,
  isConnected: false,
  connect: () => {},
  disconnect: () => {},
})

export function useTonConnect() {
  return useContext(TonConnectContext)
}

/**
 * TON Connect provider.
 *
 * Wraps children with TON Connect UI provider if the SDK is available.
 * Falls back gracefully if @tonconnect/ui-react is not installed.
 */
export function TonConnectProvider({ children }: { children: ReactNode }) {
  // Try to dynamically import TON Connect
  // This allows the app to work even if the package isn't installed yet
  const value = useMemo<TonConnectContextType>(() => {
    try {
      // Check if the module is available (will throw if not installed)
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const tonconnect = require('@tonconnect/ui-react')
      const { useTonAddress: _useTonAddress, useTonConnectUI: _useTonConnectUI, useTonWallet: _useTonWallet } = tonconnect

      return {
        isAvailable: true,
        wallet: null, // Will be populated by the actual hook in the component tree
        isConnected: false,
        connect: () => {},
        disconnect: () => {},
      }
    } catch {
      // @tonconnect/ui-react not installed — return fallback
      return {
        isAvailable: false,
        wallet: null,
        isConnected: false,
        connect: () => {
          console.warn('TON Connect not available. Install @tonconnect/ui-react')
        },
        disconnect: () => {},
      }
    }
  }, [])

  // If TON Connect is available, wrap with the UI provider
  if (value.isAvailable) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { TonConnectUIProvider } = require('@tonconnect/ui-react')
      return (
        <TonConnectUIProvider manifestUrl="https://app.suwappu.bot/tonconnect-manifest.json">
          <TonConnectInner>{children}</TonConnectInner>
        </TonConnectUIProvider>
      )
    } catch {
      // Fallback
    }
  }

  return (
    <TonConnectContext.Provider value={value}>
      {children}
    </TonConnectContext.Provider>
  )
}

/**
 * Inner component that uses the actual TON Connect hooks.
 * Only rendered when @tonconnect/ui-react is available.
 */
function TonConnectInner({ children }: { children: ReactNode }) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { useTonAddress, useTonConnectUI, useTonWallet } = require('@tonconnect/ui-react')

    const wallet = useTonWallet()
    const address = useTonAddress()
    const [tonConnectUI] = useTonConnectUI()

    const value: TonConnectContextType = {
      isAvailable: true,
      wallet: wallet
        ? {
            address: address || '',
            chain: wallet.account?.chain || '-239',
            publicKey: wallet.account?.publicKey,
          }
        : null,
      isConnected: !!wallet,
      connect: () => tonConnectUI.openModal(),
      disconnect: () => tonConnectUI.disconnect(),
    }

    return (
      <TonConnectContext.Provider value={value}>
        {children}
      </TonConnectContext.Provider>
    )
  } catch {
    // If hooks fail, render children without context
    return <>{children}</>
  }
}
