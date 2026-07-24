/**
 * Header showing connected wallet address and auth method.
 * Supports Turnkey passkey and Telegram auth.
 */

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { logoutTurnkey } from '../../lib/turnkey-passkey'
import { hasValidSession, getWalletAddress, getAuthMethod, clearAuthToken } from '../../lib/auth'
import { isTelegramWebApp, getInitData } from '../../lib/telegram'
import { api } from '../../lib/api'

function truncateAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

export function WalletHeader() {
  const [showAccountMenu, setShowAccountMenu] = useState(false)

  // Check if we're in Telegram
  const isTelegramAuth = isTelegramWebApp() && !!getInitData()

  // Fetch Telegram wallet (same query key as App.tsx so they share cache)
  const { data: telegramWallet } = useQuery({
    queryKey: ['telegram', 'wallet'],
    queryFn: async () => {
      if (!isTelegramAuth) return null
      return api.getOrCreateWallet()
    },
    enabled: isTelegramAuth,
    staleTime: 60 * 1000,
    retry: false,
  })

  // Turnkey/Passkey state - use stored wallet address from localStorage
  const [turnkeyData, setTurnkeyData] = useState(() => {
    const isPasskeyAuth = getAuthMethod() === 'passkey' && hasValidSession()
    const address = getWalletAddress()
    return {
      isConnected: isPasskeyAuth && !!address,
      address: isPasskeyAuth ? address : null,
    }
  })

  // Determine which wallet is active (Telegram takes precedence)
  const isTurnkeyAuth = !isTelegramAuth && turnkeyData?.isConnected
  const isConnected = isTelegramAuth || turnkeyData?.isConnected
  const address = (isTelegramAuth ? telegramWallet?.address : null) || turnkeyData?.address

  const copyAddress = async () => {
    if (address) {
      await navigator.clipboard.writeText(address)
    }
  }

  const handleDisconnect = async () => {
    if (isTurnkeyAuth) {
      await logoutTurnkey()
      clearAuthToken()
      setTurnkeyData({ isConnected: false, address: null })
    }
    setShowAccountMenu(false)
  }

  return (
    <header className="sticky top-0 z-50 bg-white/90 backdrop-blur-md border-b border-suwappu-sakura-mid/20">
      <div className="flex items-center justify-between h-14 px-3">
        {/* Logo */}
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-suwappu-gradient flex items-center justify-center shadow-xs">
            <span className="text-white text-sm font-bold">S</span>
          </div>
          <span className="font-heading font-bold text-suwappu-purple-deep">Suwappu</span>
        </div>

        {/* Wallet Info */}
        {isConnected && address ? (
          <div className="flex items-center gap-2">
            {/* Auth method badge */}
            {isTelegramAuth && (
              <div className="px-2.5 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
                Telegram
              </div>
            )}
            {isTurnkeyAuth && (
              <div className="px-2.5 py-1 rounded-full text-xs font-medium bg-purple-100 text-purple-700">
                Passkey
              </div>
            )}

            {/* Address Button */}
            <div className="relative">
              <button
                onClick={() => setShowAccountMenu(!showAccountMenu)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-suwappu-sakura-light/50 hover:bg-suwappu-sakura-light rounded-full text-xs font-medium text-suwappu-purple-deep transition-colors"
              >
                <span>{isTelegramAuth ? '✈️' : '🔐'}</span>
                <span>{truncateAddress(address)}</span>
              </button>

              {/* Account Dropdown */}
              {showAccountMenu && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setShowAccountMenu(false)} />
                  <div className="absolute right-0 mt-2 w-48 bg-white rounded-xl shadow-lg border border-suwappu-sakura-mid/20 py-1 z-20">
                    <button
                      onClick={() => {
                        copyAddress()
                        setShowAccountMenu(false)
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-suwappu-sakura-light/30 transition-colors"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                      Copy Address
                    </button>
                    {/* Hide disconnect for Telegram users - they can't disconnect */}
                    {!isTelegramAuth && (
                      <button
                        onClick={handleDisconnect}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                        </svg>
                        Disconnect
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        ) : (
          <div className="px-3 py-1.5 bg-yellow-50 border border-yellow-200 rounded-full text-xs text-yellow-700">
            Not Connected
          </div>
        )}
      </div>
    </header>
  )
}
