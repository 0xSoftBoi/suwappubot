/**
 * Authentication Context for Suwappu Webapp
 *
 * Provides unified auth state for both Telegram and Turnkey authentication.
 * Telegram auth is primary (from Mini App), with optional Turnkey wallet linking.
 */

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from 'react'
import type {
  AuthMethod,
  TelegramUser,
  LinkedWallet,
} from '../types/auth'
import { getTelegramUser, getInitData } from '../lib/telegram'
import {
  setAuthToken,
  setAuthMethod as storeAuthMethod,
  getAuthMethod as getStoredAuthMethod,
  clearAuthToken,
} from '../lib/auth'
import { formatAddress } from '../lib/turnkey'
import {
  isPasskeySupported,
  isPlatformAuthenticatorAvailable,
  registerPasskey,
  authenticateWithPasskey,
  createTurnkeyWallet,
} from '../lib/turnkey-passkey'
import { authenticateWithOAuth } from '../lib/turnkey-client'
import { api } from '../lib/api'

// Standalone wallet info for non-Telegram auth
interface WalletInfo {
  address: string
  type: 'passkey' | 'oauth'
}

// Auth context state
interface AuthContextType {
  // Telegram auth state
  telegramUser: TelegramUser | null
  isTelegramAuth: boolean

  // Wallet state
  linkedWallets: LinkedWallet[]
  isPasskeySupported: boolean
  isPlatformAuthAvailable: boolean

  // Loading/error states
  isLoading: boolean
  error: string | null

  // Combined auth state
  isAuthenticated: boolean
  authMethod: AuthMethod

  // Standalone wallet auth (for non-Telegram usage)
  walletInfo: WalletInfo | null

  // Actions
  createPasskeyWallet: (displayName?: string) => Promise<boolean>
  loginWithPasskey: () => Promise<boolean>
  loginWithOAuth: (provider: string, oauthToken: string) => Promise<boolean>
  createWallet: (chainType: 'evm' | 'solana', name?: string) => Promise<string | null>
  refreshWallets: () => Promise<void>
  clearError: () => void
  logout: () => void
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

interface AuthProviderProps {
  children: ReactNode
}

export function AuthProvider({ children }: AuthProviderProps) {
  // Telegram state
  const [telegramUser, setTelegramUser] = useState<TelegramUser | null>(null)
  const [isTelegramAuth, setIsTelegramAuth] = useState(false)

  // Wallet state
  const [linkedWallets, setLinkedWallets] = useState<LinkedWallet[]>([])
  const [passkeySupported, setPasskeySupported] = useState(false)
  const [platformAuthAvailable, setPlatformAuthAvailable] = useState(false)

  // Standalone wallet auth state
  const [walletInfo, setWalletInfo] = useState<WalletInfo | null>(() => {
    const stored = localStorage.getItem('suwappu_wallet')
    return stored ? JSON.parse(stored) : null
  })

  // Loading/error state
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Auth method tracking
  const [authMethod, setAuthMethod] = useState<AuthMethod>(null)

  // Derived state - include standalone wallet auth
  const isAuthenticated = isTelegramAuth || linkedWallets.length > 0 || walletInfo !== null

  // Initialize on mount
  useEffect(() => {
    const init = async () => {
      try {
        setIsLoading(true)

        // Check Telegram auth
        const tgUser = getTelegramUser()
        const initData = getInitData()

        if (tgUser && initData) {
          setTelegramUser(tgUser)
          setIsTelegramAuth(true)
          setAuthMethod('telegram')
          storeAuthMethod('telegram')

          // Authenticate with backend — this creates user + Turnkey wallet if needed
          try {
            const authResult = await api.telegramAuth(initData)
            if (authResult.success) {
              // Store JWT for subsequent API calls (7-day expiry)
              if (authResult.jwt) {
                const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
                setAuthToken(authResult.jwt, expiresAt)
              }
              // If wallet was auto-created, store it
              if (authResult.walletAddress) {
                login({ address: authResult.walletAddress, type: 'passkey' })
              }
            } else {
              console.error('Telegram auth failed:', authResult.error)
            }
          } catch (err) {
            console.error('Telegram auth request failed:', err)
          }
        }

        // Check passkey support
        setPasskeySupported(isPasskeySupported())

        // Check platform authenticator
        const platformAuth = await isPlatformAuthenticatorAvailable()
        setPlatformAuthAvailable(platformAuth)

        // Load linked wallets if authenticated
        if (tgUser && initData) {
          await refreshWalletsInternal()
        }

        // Restore stored auth method
        const storedMethod = getStoredAuthMethod()
        if (storedMethod && !authMethod) {
          setAuthMethod(storedMethod)
        }
      } catch (err) {
        console.error('Auth init error:', err)
      } finally {
        setIsLoading(false)
      }
    }

    init()
  }, [])

  // Internal wallet refresh
  const refreshWalletsInternal = async () => {
    try {
      const wallets = await api.getLinkedWallets()
      setLinkedWallets(wallets)
    } catch (err) {
      console.error('Failed to fetch wallets:', err)
    }
  }

  // Public wallet refresh
  const refreshWallets = useCallback(async () => {
    if (!isTelegramAuth) return
    await refreshWalletsInternal()
  }, [isTelegramAuth])

  // Create passkey wallet
  const createPasskeyWallet = useCallback(async (displayName?: string): Promise<boolean> => {
    if (!passkeySupported) {
      setError('Passkeys are not supported in this browser')
      return false
    }

    try {
      setIsLoading(true)
      setError(null)

      const result = await registerPasskey(displayName || telegramUser?.first_name)

      if (result.success) {
        // Store wallet info for standalone auth
        if (result.walletAddress) {
          login({ address: result.walletAddress, type: 'passkey' })
        }
        if (isTelegramAuth) {
          await refreshWalletsInternal()
        }
        return true
      } else {
        setError(result.error || 'Failed to create passkey wallet')
        return false
      }
    } catch (err: any) {
      console.error('Passkey registration failed:', err)
      setError(err.message || 'Failed to create passkey wallet')
      return false
    } finally {
      setIsLoading(false)
    }
  }, [passkeySupported, telegramUser, isTelegramAuth])

  // Login with existing passkey
  const loginWithPasskey = useCallback(async (): Promise<boolean> => {
    if (!passkeySupported) {
      setError('Passkeys are not supported in this browser')
      return false
    }

    try {
      setIsLoading(true)
      setError(null)

      const result = await authenticateWithPasskey()

      if (result.success) {
        setAuthToken(result.token, result.expiresAt)
        // Store wallet info for standalone auth
        if (result.walletAddress) {
          login({ address: result.walletAddress, type: 'passkey' })
        } else {
          setAuthMethod('passkey')
          storeAuthMethod('passkey')
        }
        if (isTelegramAuth) {
          await refreshWalletsInternal()
        }
        return true
      } else {
        setError(result.error || 'Passkey authentication failed')
        return false
      }
    } catch (err: any) {
      console.error('Passkey login failed:', err)
      setError(err.message || 'Failed to authenticate with passkey')
      return false
    } finally {
      setIsLoading(false)
    }
  }, [passkeySupported, isTelegramAuth])

  // Login with OAuth provider (Google/Twitter) and create Turnkey wallet
  const loginWithOAuth = useCallback(async (provider: string, oauthToken: string): Promise<boolean> => {
    try {
      setIsLoading(true)
      setError(null)

      const tgUserId = telegramUser?.id?.toString() || ''
      if (!tgUserId) {
        setError('Telegram user not available for OAuth wallet creation')
        return false
      }

      const result = await authenticateWithOAuth(provider, oauthToken, tgUserId)

      if (result.address) {
        login({ address: result.address, type: 'oauth' })
        if (isTelegramAuth) {
          await refreshWalletsInternal()
        }
        return true
      } else {
        setError('OAuth wallet creation returned no address')
        return false
      }
    } catch (err: any) {
      console.error('OAuth login failed:', err)
      setError(err.message || 'Failed to create OAuth wallet')
      return false
    } finally {
      setIsLoading(false)
    }
  }, [telegramUser, isTelegramAuth])

  // Create a new Turnkey wallet (after initial passkey registration)
  const createWallet = useCallback(async (
    chainType: 'evm' | 'solana',
    name?: string
  ): Promise<string | null> => {
    try {
      setIsLoading(true)
      setError(null)

      const result = await createTurnkeyWallet(chainType, name)

      if (result.success && result.address) {
        if (isTelegramAuth) {
          await refreshWalletsInternal()
        }
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
  }, [isTelegramAuth])

  // Clear error
  const clearError = useCallback(() => {
    setError(null)
  }, [])

  // Simple login for standalone mode (non-Telegram)
  const login = useCallback((wallet: WalletInfo) => {
    setWalletInfo(wallet)
    localStorage.setItem('suwappu_wallet', JSON.stringify(wallet))
    setAuthMethod('passkey')
    storeAuthMethod('passkey')
  }, [])

  // Logout for standalone mode
  const logout = useCallback(() => {
    setWalletInfo(null)
    localStorage.removeItem('suwappu_wallet')
    setAuthMethod(null)
    clearAuthToken()
  }, [])

  const value: AuthContextType = {
    telegramUser,
    isTelegramAuth,
    linkedWallets,
    isPasskeySupported: passkeySupported,
    isPlatformAuthAvailable: platformAuthAvailable,
    isLoading,
    error,
    isAuthenticated,
    authMethod,
    walletInfo,
    createPasskeyWallet,
    loginWithPasskey,
    loginWithOAuth,
    createWallet,
    refreshWallets,
    clearError,
    logout,
  }

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}

// Re-export formatAddress for convenience
export { formatAddress }
