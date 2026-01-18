/**
 * AuthGate component - Wrapper that requires authentication
 */

import type { ReactNode } from 'react'
import { useAuth } from '../../hooks/useAuth'

interface AuthGateProps {
  children: ReactNode
  requireWallet?: boolean
  fallback?: ReactNode
}

export function AuthGate({
  children,
  requireWallet = false,
  fallback,
}: AuthGateProps) {
  const { isAuthenticated, isTelegramAuth, linkedWallets, isLoading } = useAuth()

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-pulse text-tg-hint">Loading...</div>
      </div>
    )
  }

  // Check if user meets auth requirements
  const meetsRequirements = requireWallet
    ? isAuthenticated && linkedWallets.length > 0
    : isAuthenticated

  if (!meetsRequirements) {
    if (fallback) {
      return <>{fallback}</>
    }

    return (
      <div className="flex flex-col items-center justify-center p-8 text-center">
        <svg className="w-12 h-12 text-tg-hint mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
        </svg>
        <h3 className="text-lg font-semibold text-tg-text mb-2">
          {requireWallet ? 'Wallet Required' : 'Authentication Required'}
        </h3>
        <p className="text-tg-hint text-sm">
          {!isTelegramAuth
            ? 'Please open this app from Telegram'
            : requireWallet
            ? 'Please connect a wallet to continue'
            : 'Please sign in to continue'}
        </p>
      </div>
    )
  }

  return <>{children}</>
}
