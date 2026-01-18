/**
 * ConnectWallet component - MetaMask wallet connection button
 */

import { useWalletConnection } from '../../hooks/useWalletConnection'

interface ConnectWalletProps {
  onSuccess?: (address: string) => void
  onError?: (error: string) => void
  linkToAccount?: boolean
  className?: string
}

export function ConnectWallet({
  onSuccess,
  onError,
  linkToAccount = true,
  className = '',
}: ConnectWalletProps) {
  const {
    isAvailable,
    isConnected,
    address,
    isConnecting,
    error,
    connect,
    connectAndLink,
    formatAddress,
    clearError,
  } = useWalletConnection()

  const handleConnect = async () => {
    clearError()

    if (linkToAccount) {
      const success = await connectAndLink()
      if (success && address) {
        onSuccess?.(address)
      } else if (error) {
        onError?.(error)
      }
    } else {
      const connectedAddress = await connect()
      if (connectedAddress) {
        onSuccess?.(connectedAddress)
      } else if (error) {
        onError?.(error)
      }
    }
  }

  if (!isAvailable) {
    return (
      <a
        href="https://metamask.io/download/"
        target="_blank"
        rel="noopener noreferrer"
        className={`flex items-center justify-center gap-2 px-4 py-3 bg-orange-500 text-white rounded-lg font-medium transition-colors hover:bg-orange-600 ${className}`}
      >
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
          <path d="M21.5 11.75L18.75 9l1-3.5-2.25.75L15 4l-3 2.5L9 4 6.5 6.25l-2.25-.75 1 3.5L2.5 11.75l2.75 2.75-.5 3.25 3-1 2.25 2 2-1.5 2 1.5 2.25-2 3 1-.5-3.25 2.75-2.75zM12 15.5c-1.93 0-3.5-1.57-3.5-3.5S10.07 8.5 12 8.5s3.5 1.57 3.5 3.5-1.57 3.5-3.5 3.5z"/>
        </svg>
        Install MetaMask
      </a>
    )
  }

  if (isConnected && address) {
    return (
      <div className={`flex items-center gap-2 px-4 py-3 bg-tg-secondary rounded-lg ${className}`}>
        <div className="w-2 h-2 rounded-full bg-green-500" />
        <span className="text-tg-text font-medium">{formatAddress(address)}</span>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <button
        onClick={handleConnect}
        disabled={isConnecting}
        className={`flex items-center justify-center gap-2 w-full px-4 py-3 bg-tg-button text-tg-button-text rounded-lg font-medium transition-opacity disabled:opacity-50 ${className}`}
      >
        {isConnecting ? (
          <>
            <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            Connecting...
          </>
        ) : (
          <>
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M21.5 11.75L18.75 9l1-3.5-2.25.75L15 4l-3 2.5L9 4 6.5 6.25l-2.25-.75 1 3.5L2.5 11.75l2.75 2.75-.5 3.25 3-1 2.25 2 2-1.5 2 1.5 2.25-2 3 1-.5-3.25 2.75-2.75z"/>
            </svg>
            Connect Wallet
          </>
        )}
      </button>

      {error && (
        <p className="text-sm text-red-500 text-center">{error}</p>
      )}
    </div>
  )
}
