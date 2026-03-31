import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from 'react'
import { useAccount, useSignMessage, useDisconnect } from 'wagmi'
import { setAuthToken, getAuthToken, clearAuthToken } from '../lib/auth'
import { api } from '../lib/api'

interface AuthContextType {
  isAuthenticated: boolean
  isLoading: boolean
  userId: number | null
  walletAddress: string | null
  error: string | null
  signIn: () => Promise<void>
  signOut: () => void
  clearError: () => void
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const { address, isConnected } = useAccount()
  const { signMessageAsync } = useSignMessage()
  const { disconnect } = useDisconnect()

  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [userId, setUserId] = useState<number | null>(null)
  const [walletAddress, setWalletAddress] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Check existing session on mount
  useEffect(() => {
    const checkSession = async () => {
      const token = getAuthToken()
      if (!token) {
        setIsLoading(false)
        return
      }
      try {
        const me = await api.getMe()
        setUserId(me.userId)
        setWalletAddress(me.walletAddress)
        setIsAuthenticated(true)
      } catch {
        clearAuthToken()
      } finally {
        setIsLoading(false)
      }
    }
    checkSession()
  }, [])

  // Sign in with connected wallet
  const signIn = useCallback(async () => {
    if (!address || !isConnected) {
      setError('Connect your wallet first')
      return
    }

    try {
      setIsLoading(true)
      setError(null)

      // 1. Get challenge nonce
      const { nonce, message } = await api.walletChallenge(address)

      // 2. Sign message
      const signature = await signMessageAsync({ message })

      // 3. Verify signature & get JWT
      const result = await api.walletVerify(address, signature, nonce)

      // 4. Store token
      setAuthToken(result.token, result.expiresAt)
      setUserId(result.userId)
      setWalletAddress(address)
      setIsAuthenticated(true)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Sign-in failed'
      setError(message)
    } finally {
      setIsLoading(false)
    }
  }, [address, isConnected, signMessageAsync])

  // Auto sign-in when wallet connects and no session exists
  useEffect(() => {
    if (isConnected && address && !isAuthenticated && !isLoading && !getAuthToken()) {
      signIn()
    }
  }, [isConnected, address, isAuthenticated, isLoading, signIn])

  const signOut = useCallback(() => {
    clearAuthToken()
    setIsAuthenticated(false)
    setUserId(null)
    setWalletAddress(null)
    disconnect()
  }, [disconnect])

  const clearError = useCallback(() => setError(null), [])

  return (
    <AuthContext.Provider
      value={{
        isAuthenticated,
        isLoading,
        userId,
        walletAddress,
        error,
        signIn,
        signOut,
        clearError,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used within AuthProvider')
  return context
}
