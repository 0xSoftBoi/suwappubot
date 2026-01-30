/**
 * Header showing connected wallet address and chain.
 * Supports MetaMask (via wagmi), Turnkey passkey, and Telegram auth.
 */

import { useState, useEffect } from 'react'
import { useAccount, useBalance, useChainId, useSwitchChain, useDisconnect } from 'wagmi'
import { useQuery } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { supportedChains, getChainMeta } from '../../lib/wagmi-config'
import { logoutTurnkey } from '../../lib/turnkey-passkey'
import { hasValidSession, getWalletAddress, getAuthMethod, clearAuthToken } from '../../lib/auth'
import { isTelegramWebApp, getInitData } from '../../lib/telegram'
import { api } from '../../lib/api'

function truncateAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

export function WalletHeader() {
  const [showChainMenu, setShowChainMenu] = useState(false)
  const [showAccountMenu, setShowAccountMenu] = useState(false)

  // Wagmi state
  const { address: wagmiAddress, isConnected: wagmiConnected } = useAccount()
  const chainId = useChainId()
  const { switchChain, isPending: isSwitching } = useSwitchChain()
  const { disconnect: wagmiDisconnect } = useDisconnect()

  // Check if we're in Telegram
  const isTelegramAuth = isTelegramWebApp() && !!getInitData()

  // Fetch Telegram wallet (same query key as App.tsx so they share cache)
  const { data: telegramWallet, error: walletError, status: queryStatus } = useQuery({
    queryKey: ['telegram', 'wallet'],
    queryFn: async () => {
      toast('Calling API...', { duration: 2000 })
      if (!isTelegramAuth) {
        toast('Not TG auth, returning null')
        return null
      }
      try {
        const result = await api.getOrCreateWallet()
        toast(`API returned: ${JSON.stringify(result)?.slice(0, 50)}`, { duration: 4000 })
        return result
      } catch (e: any) {
        toast.error(`API error: ${e.message || e.detail || JSON.stringify(e)}`)
        throw e
      }
    },
    enabled: isTelegramAuth,
    staleTime: 60 * 1000,
    retry: false,
  })

  // Debug toast on mount/changes
  useEffect(() => {
    const inTg = isTelegramWebApp()
    const hasInit = !!getInitData()
    toast(`TG: ${inTg}, Init: ${hasInit}, Auth: ${isTelegramAuth}`, { duration: 5000 })
  }, [isTelegramAuth])

  useEffect(() => {
    toast(`Query status: ${queryStatus}`, { duration: 3000 })
  }, [queryStatus])

  useEffect(() => {
    if (walletError) {
      toast.error(`Wallet err: ${(walletError as Error).message}`)
    } else if (telegramWallet) {
      toast.success(`Got wallet: ${telegramWallet.address?.slice(0, 10)}...`)
    }
  }, [telegramWallet, walletError])

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
  const isTurnkeyAuth = !wagmiConnected && !isTelegramAuth && turnkeyData?.isConnected
  const isConnected = isTelegramAuth || wagmiConnected || turnkeyData?.isConnected
  const address = (isTelegramAuth ? telegramWallet?.address : null) || wagmiAddress || turnkeyData?.address

  // Get balance - only works for wagmi/MetaMask
  const { data: balance } = useBalance({
    address: wagmiAddress,
    query: { enabled: wagmiConnected },
  })

  const chainMeta = getChainMeta(chainId)

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
    } else {
      wagmiDisconnect()
    }
    setShowAccountMenu(false)
  }

  return (
    <header className="sticky top-0 z-50 bg-white/90 backdrop-blur-md border-b border-suwappu-sakura-mid/20">
      <div className="flex items-center justify-between h-14 px-3">
        {/* Logo */}
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-suwappu-gradient flex items-center justify-center shadow-sm">
            <span className="text-white text-sm font-bold">S</span>
          </div>
          <span className="font-heading font-bold text-suwappu-purple-deep">Suwappu</span>
        </div>

        {/* Wallet Info */}
        {isConnected && address ? (
          <div className="flex items-center gap-2">
            {/* Chain Selector - only for MetaMask */}
            {wagmiConnected && (
              <div className="relative">
                <button
                  onClick={() => setShowChainMenu(!showChainMenu)}
                  disabled={isSwitching}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium ${chainMeta.color} text-white shadow-sm transition-all hover:opacity-90 disabled:opacity-50`}
                >
                  <span>{chainMeta.icon}</span>
                  <span className="hidden sm:inline">{chainMeta.name}</span>
                  <svg className={`w-3 h-3 transition-transform ${showChainMenu ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {/* Chain Dropdown */}
                {showChainMenu && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setShowChainMenu(false)} />
                    <div className="absolute right-0 mt-2 w-48 bg-white rounded-xl shadow-lg border border-suwappu-sakura-mid/20 py-1 z-20">
                      {supportedChains.map((c) => {
                        const meta = getChainMeta(c.id)
                        const isActive = c.id === chainId
                        return (
                          <button
                            key={c.id}
                            onClick={() => {
                              switchChain({ chainId: c.id })
                              setShowChainMenu(false)
                            }}
                            disabled={isSwitching}
                            className={`w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-suwappu-sakura-light/30 transition-colors ${
                              isActive ? 'bg-suwappu-sakura-light/50 font-medium' : ''
                            }`}
                          >
                            <span className={`w-6 h-6 rounded-full ${meta.color} flex items-center justify-center text-white text-xs`}>
                              {meta.icon}
                            </span>
                            <span>{meta.name}</span>
                            {isActive && (
                              <svg className="w-4 h-4 ml-auto text-suwappu-success" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                              </svg>
                            )}
                          </button>
                        )
                      })}
                    </div>
                  </>
                )}
              </div>
            )}

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
                <span>{isTelegramAuth ? '✈️' : isTurnkeyAuth ? '🔐' : '🦊'}</span>
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

      {/* Balance Bar - only for MetaMask */}
      {wagmiConnected && balance && (
        <div className="flex items-center justify-between px-3 py-1.5 bg-suwappu-sakura-light/30 border-t border-suwappu-sakura-mid/10 text-xs">
          <span className="text-suwappu-text-secondary">Balance:</span>
          <span className="font-medium text-suwappu-purple-deep">
            {(Number(balance.value) / 10 ** balance.decimals).toFixed(4)} {balance.symbol}
          </span>
        </div>
      )}
    </header>
  )
}
