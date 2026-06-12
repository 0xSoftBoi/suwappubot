/**
 * WalletInfo component - Display connected wallet information
 */

import { formatAddress } from '../../contexts/AuthContext'
import type { LinkedWallet } from '../../types/auth'

interface WalletInfoProps {
  wallet: LinkedWallet
  onUnlink?: () => void
  isUnlinking?: boolean
}

export function WalletInfo({ wallet, onUnlink, isUnlinking }: WalletInfoProps) {
  const getProviderLabel = (provider: string) => {
    switch (provider) {
      case 'turnkey':
        return 'Secure Wallet'
      case 'external':
        return 'External'
      default:
        return 'Local'
    }
  }

  const getChainLabel = (chainType: string) => {
    switch (chainType) {
      case 'evm':
        return 'Ethereum'
      case 'solana':
        return 'Solana'
      default:
        return chainType.toUpperCase()
    }
  }

  return (
    <div className="bg-tg-secondary rounded-lg p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {/* Chain icon */}
          <div className="w-10 h-10 rounded-full bg-tg-bg flex items-center justify-center">
            {wallet.chainType === 'evm' ? (
              <svg className="w-5 h-5 text-tg-text" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 1.5l-9 5.25v10.5l9 5.25 9-5.25V6.75L12 1.5zm0 2.25l6.75 3.938L12 11.625 5.25 7.688 12 3.75zM4.5 9.188l6.75 3.937v6.75L4.5 15.938v-6.75zm15 0v6.75l-6.75 3.937v-6.75l6.75-3.937z"/>
              </svg>
            ) : (
              <svg className="w-5 h-5 text-tg-text" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
              </svg>
            )}
          </div>

          {/* Wallet details */}
          <div>
            <div className="font-medium text-tg-text">
              {formatAddress(wallet.address)}
            </div>
            <div className="text-xs text-tg-hint flex items-center gap-2">
              <span>{getChainLabel(wallet.chainType)}</span>
              <span className="w-1 h-1 rounded-full bg-tg-hint" />
              <span>{getProviderLabel(wallet.provider)}</span>
            </div>
          </div>
        </div>

        {/* Unlink button */}
        {onUnlink && (
          <button
            onClick={onUnlink}
            disabled={isUnlinking}
            className="text-tg-hint hover:text-red-500 transition-colors p-2 disabled:opacity-50"
            title="Unlink wallet"
          >
            {isUnlinking ? (
              <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            ) : (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            )}
          </button>
        )}
      </div>
    </div>
  )
}
