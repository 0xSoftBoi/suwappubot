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
import {
  isWalletAvailable,
  getCurrentAddress,
  connectAndLinkWallet,
  onAccountsChanged,
  formatAddress,
} from '../lib/turnkey'
import {
  isPasskeySupported,
  isPlatformAuthenticatorAvailable,
  registerPasskey,
  authenticateWithPasskey,
} from '../lib/turnkey-passkey'
import { api } from '../lib/api'

// Standalone wallet info for non-Telegram auth
interface WalletInfo {
  address: string
  type: 'passkey' | 'metamask' | 'walletconnect'
}

// Auth context state
interface AuthContextType {
  // Telegram auth state
  telegramUser: TelegramUser | null
  isTelegramAuth: boolean

  // Wallet state
  linkedWallets: LinkedWallet[]
  connectedAddress: string | null
  isWalletAvailable: boolean
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
  connectWallet: () => Promise<void>
  createPasskeyWallet: (displayName?: string) => Promise<void>
  loginWithPasskey: () => Promise<void>
  refreshWallets: () => Promise<void>
  clearError: () => void
  // Simple login/logout for standalone mode
  login: (wallet: WalletInfo) => void
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
  const [connectedAddress, setConnectedAddress] = useState<string | null>(null)
  const [walletAvailable, setWalletAvailable] = useState(false)
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
        }

        // Check wallet availability
        setWalletAvailable(isWalletAvailable())
        setPasskeySupported(isPasskeySupported())

        // Check platform authenticator
        const platformAuth = await isPlatformAuthenticatorAvailable()
        setPlatformAuthAvailable(platformAuth)

        // Check current wallet connection
        const address = await getCurrentAddress()
        if (address) {
          setConnectedAddress(address)
        }

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

  // Listen for wallet account changes
  useEffect(() => {
    if (!walletAvailable) return

    const unsubscribe = onAccountsChanged((accounts) => {
      if (accounts.length === 0) {
        setConnectedAddress(null)
      } else {
        setConnectedAddress(accounts[0])
      }
    })

    return unsubscribe
  }, [walletAvailable])

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

  // Connect and link MetaMask wallet
  const connectWallet = useCallback(async () => {
    if (!isTelegramAuth) {
      setError('Please open this app from Telegram first')
      return
    }

    try {
      setIsLoading(true)
      setError(null)

      const result = await connectAndLinkWallet()

      if (result.success && result.walletAddress) {
        setConnectedAddress(result.walletAddress)
        await refreshWalletsInternal()
      }
    } catch (err: any) {
      console.error('Wallet connection failed:', err)
      setError(err.message || 'Failed to connect wallet')
    } finally {
      setIsLoading(false)
    }
  }, [isTelegramAuth])

  // Create passkey wallet
  const createPasskeyWallet = useCallback(async (displayName?: string) => {
    if (!isTelegramAuth) {
      setError('Please open this app from Telegram first')
      return
    }

    if (!passkeySupported) {
      setError('Passkeys are not supported in this browser')
      return
    }

    try {
      setIsLoading(true)
      setError(null)

      const result = await registerPasskey(displayName || telegramUser?.first_name)

      if (result.success) {
        await refreshWalletsInternal()
      } else {
        setError(result.error || 'Failed to create passkey wallet')
      }
    } catch (err: any) {
      console.error('Passkey registration failed:', err)
      setError(err.message || 'Failed to create passkey wallet')
    } finally {
      setIsLoading(false)
    }
  }, [isTelegramAuth, passkeySupported, telegramUser])

  // Login with existing passkey
  const loginWithPasskey = useCallback(async () => {
    if (!passkeySupported) {
      setError('Passkeys are not supported in this browser')
      return
    }

    try {
      setIsLoading(true)
      setError(null)

      const result = await authenticateWithPasskey()

      if (result.success) {
        setAuthToken(result.token, result.expiresAt)
        setAuthMethod('passkey')
        storeAuthMethod('passkey')
        await refreshWalletsInternal()
      } else {
        setError(result.error || 'Passkey authentication failed')
      }
    } catch (err: any) {
      console.error('Passkey login failed:', err)
      setError(err.message || 'Failed to authenticate with passkey')
    } finally {
      setIsLoading(false)
    }
  }, [passkeySupported])

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
    connectedAddress,
    isWalletAvailable: walletAvailable,
    isPasskeySupported: passkeySupported,
    isPlatformAuthAvailable: platformAuthAvailable,
    isLoading,
    error,
    isAuthenticated,
    authMethod,
    walletInfo,
    connectWallet,
    createPasskeyWallet,
    loginWithPasskey,
    refreshWallets,
    clearError,
    login,
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
