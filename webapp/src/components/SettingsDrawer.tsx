/**
 * SettingsDrawer component - Slide-out drawer for wallet and settings management
 */

import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../hooks/useAuth'
import { WalletInfo, PasskeyRegister } from './auth'
import { api } from '../lib/api'

interface SettingsDrawerProps {
  isOpen: boolean
  onClose: () => void
}

export function SettingsDrawer({ isOpen, onClose }: SettingsDrawerProps) {
  const drawerRef = useRef<HTMLDivElement>(null)
  const {
    telegramUser,
    linkedWallets,
    isPasskeySupported,
    refreshWallets,
    error,
    clearError,
  } = useAuth()

  const [unlinkingAddress, setUnlinkingAddress] = useState<string | null>(null)

  // Handle escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }

    if (isOpen) {
      document.addEventListener('keydown', handleEscape)
      document.body.style.overflow = 'hidden'
    }

    return () => {
      document.removeEventListener('keydown', handleEscape)
      document.body.style.overflow = ''
    }
  }, [isOpen, onClose])

  // Handle click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (drawerRef.current && !drawerRef.current.contains(e.target as Node)) {
        onClose()
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen, onClose])

  // Handle unlink wallet
  const handleUnlink = async (address: string) => {
    try {
      setUnlinkingAddress(address)
      await api.unlinkWallet(address)
      await refreshWallets()
    } catch (err) {
      console.error('Failed to unlink wallet:', err)
    } finally {
      setUnlinkingAddress(null)
    }
  }

  // Handle passkey success
  const handlePasskeySuccess = () => {
    refreshWallets()
  }

  if (!isOpen) return null

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-40 transition-opacity"
        onClick={onClose}
      />

      {/* Drawer */}
      <div
        ref={drawerRef}
        className={`fixed top-0 right-0 h-full w-80 max-w-[85vw] bg-tg-bg z-50 shadow-xl transform transition-transform duration-300 ease-out ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-tg-secondary">
          <h2 className="text-lg font-semibold text-tg-text">Settings</h2>
          <button
            onClick={onClose}
            className="p-2 text-tg-hint hover:text-tg-text transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="overflow-y-auto h-[calc(100%-60px)] p-4 space-y-6">
          {/* User info */}
          {telegramUser && (
            <div className="bg-tg-secondary rounded-lg p-4">
              <div className="flex items-center gap-3">
                {telegramUser.photo_url ? (
                  <img
                    src={telegramUser.photo_url}
                    alt={telegramUser.first_name}
                    className="w-12 h-12 rounded-full"
                  />
                ) : (
                  <div className="w-12 h-12 rounded-full bg-tg-button flex items-center justify-center text-tg-button-text font-semibold">
                    {telegramUser.first_name.charAt(0)}
                  </div>
                )}
                <div>
                  <div className="font-medium text-tg-text">
                    {telegramUser.first_name} {telegramUser.last_name || ''}
                  </div>
                  {telegramUser.username && (
                    <div className="text-sm text-tg-hint">@{telegramUser.username}</div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Linked Wallets */}
          <div>
            <h3 className="text-sm font-medium text-tg-hint uppercase tracking-wide mb-3">
              Linked Wallets
            </h3>

            {linkedWallets.length > 0 ? (
              <div className="space-y-2">
                {linkedWallets.map((wallet) => (
                  <WalletInfo
                    key={wallet.address}
                    wallet={wallet}
                    onUnlink={linkedWallets.length > 1 ? () => handleUnlink(wallet.address) : undefined}
                    isUnlinking={unlinkingAddress === wallet.address}
                  />
                ))}
              </div>
            ) : (
              <p className="text-sm text-tg-hint py-4 text-center">
                No wallets linked yet
              </p>
            )}
          </div>

          {/* Add Wallet */}
          <div>
            <h3 className="text-sm font-medium text-tg-hint uppercase tracking-wide mb-3">
              Add Wallet
            </h3>

            <div className="space-y-3">
              {/* Passkey option */}
              {isPasskeySupported && (
                <PasskeyRegister
                  displayName={telegramUser?.first_name}
                  onSuccess={handlePasskeySuccess}
                />
              )}

              {/* No options available */}
              {!isPasskeySupported && (
                <div className="text-sm text-tg-hint text-center py-4">
                  <p>No wallet options available</p>
                  <p className="text-xs mt-1">
                    Use a browser with passkey support
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Error display */}
          {error && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3">
              <div className="flex items-start gap-2">
                <svg className="w-5 h-5 text-red-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <div>
                  <p className="text-sm text-red-500">{error}</p>
                  <button
                    onClick={clearError}
                    className="text-xs text-red-400 underline mt-1"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* App info */}
          <div className="pt-4 border-t border-tg-secondary">
            <div className="text-xs text-tg-hint text-center space-y-1">
              <p>Suwappu v1.0</p>
              <p>Cross-chain DEX Bot</p>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
