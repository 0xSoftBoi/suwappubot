/**
 * Hook for passkey (WebAuthn) authentication
 *
 * Provides passkey-specific state and actions for creating and authenticating
 * with passkeys/biometrics.
 */

import { useState, useCallback, useEffect } from 'react'
import {
  isPasskeySupported,
  isPlatformAuthenticatorAvailable,
  registerPasskey,
  authenticateWithPasskey,
  getTurnkeyWallets,
  createTurnkeyWallet,
} from '../lib/turnkey-passkey'
import { setAuthToken, setAuthMethod } from '../lib/auth'

interface TurnkeyWallet {
  id: string
  address: string
  chainType: string
  name: string
}

interface UsePasskeyReturn {
  // State
  isSupported: boolean
  isPlatformAvailable: boolean
  isLoading: boolean
  error: string | null
  wallets: TurnkeyWallet[]

  // Actions
  register: (displayName?: string) => Promise<boolean>
  authenticate: () => Promise<boolean>
  createWallet: (chainType: 'evm' | 'solana', name?: string) => Promise<string | null>
  refreshWallets: () => Promise<void>
  clearError: () => void
}

export function usePasskey(): UsePasskeyReturn {
  const [isSupported, setIsSupported] = useState(false)
  const [isPlatformAvailable, setIsPlatformAvailable] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [wallets, setWallets] = useState<TurnkeyWallet[]>([])

  // Initialize
  useEffect(() => {
    const init = async () => {
      const supported = isPasskeySupported()
      setIsSupported(supported)

      if (supported) {
        const platformAvailable = await isPlatformAuthenticatorAvailable()
        setIsPlatformAvailable(platformAvailable)
      }
    }

    init()
  }, [])

  // Refresh wallets
  const refreshWallets = useCallback(async () => {
    try {
      const fetchedWallets = await getTurnkeyWallets()
      setWallets(fetchedWallets)
    } catch (err) {
      console.error('Failed to fetch Turnkey wallets:', err)
    }
  }, [])

  // Register a new passkey
  const register = useCallback(async (displayName?: string): Promise<boolean> => {
    if (!isSupported) {
      setError('Passkeys are not supported in this browser')
      return false
    }

    try {
      setIsLoading(true)
      setError(null)

      const result = await registerPasskey(displayName)

      if (result.success) {
        await refreshWallets()
        return true
      } else {
        setError(result.error || 'Failed to create passkey')
        return false
      }
    } catch (err: any) {
      setError(err.message || 'Failed to register passkey')
      return false
    } finally {
      setIsLoading(false)
    }
  }, [isSupported, refreshWallets])

  // Authenticate with passkey
  const authenticate = useCallback(async (): Promise<boolean> => {
    if (!isSupported) {
      setError('Passkeys are not supported in this browser')
      return false
    }

    try {
      setIsLoading(true)
      setError(null)

      const result = await authenticateWithPasskey()

      if (result.success) {
        // Store the JWT token
        setAuthToken(result.token, result.expiresAt)
        setAuthMethod('passkey')

        await refreshWallets()
        return true
      } else {
        setError(result.error || 'Authentication failed')
        return false
      }
    } catch (err: any) {
      setError(err.message || 'Failed to authenticate')
      return false
    } finally {
      setIsLoading(false)
    }
  }, [isSupported, refreshWallets])

  // Create a new Turnkey wallet
  const createWallet = useCallback(async (
    chainType: 'evm' | 'solana',
    name?: string
  ): Promise<string | null> => {
    try {
      setIsLoading(true)
      setError(null)

      const result = await createTurnkeyWallet(chainType, name)

      if (result.success && result.address) {
        await refreshWallets()
        return result.address
      } else {
        setError(result.error || 'Failed to create wallet')
        return null
      }
    } catch (err: any) {
      setError(err.message || 'Failed to create wallet')
      return null
    } finally {
      setIsLoading(false)
    }
  }, [refreshWallets])

  // Clear error
  const clearError = useCallback(() => {
    setError(null)
  }, [])

  return {
    isSupported,
    isPlatformAvailable,
    isLoading,
    error,
    wallets,
    register,
    authenticate,
    createWallet,
    refreshWallets,
    clearError,
  }
}
