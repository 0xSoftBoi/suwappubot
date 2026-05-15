import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from 'react'
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
  isPasskeySupported: boolean
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [userId, setUserId] = useState<number | null>(null)
  const [walletAddress, setWalletAddress] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isPasskeySupported, setIsPasskeySupported] = useState(false)

  const toBase64Url = (buffer: ArrayBuffer): string => {
    const bytes = new Uint8Array(buffer)
    let binary = ''
    for (const byte of bytes) binary += String.fromCharCode(byte)
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
  }

  const credentialChallenge = (value: string): Uint8Array => new TextEncoder().encode(value)

  const rpIdForCurrentHost = (): string => {
    if (typeof window === 'undefined') return 'suwappu.bot'
    const host = window.location.hostname
    if (host === 'suwappu.bot' || host.endsWith('.suwappu.bot')) return 'suwappu.bot'
    return host
  }

  // Check existing session on mount
  useEffect(() => {
    const checkSession = async () => {
      setIsPasskeySupported(
        typeof window !== 'undefined' &&
        !!window.PublicKeyCredential &&
        window.isSecureContext,
      )

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

  // Create a Turnkey-backed passkey wallet for terminal auth.
  const signIn = useCallback(async () => {
    if (
      typeof navigator === 'undefined' ||
      !navigator.credentials ||
      typeof window === 'undefined' ||
      !window.PublicKeyCredential
    ) {
      setError('Passkeys are not supported in this browser')
      return
    }

    try {
      setIsLoading(true)
      setError(null)

      const init = await api.passkeyRegisterInit('Suwappu Terminal')
      const credential = await navigator.credentials.create({
        publicKey: {
          challenge: credentialChallenge(init.challenge),
          rp: {
            id: rpIdForCurrentHost(),
            name: init.rpName || 'Suwappu',
          },
          user: {
            id: credentialChallenge(init.userId),
            name: init.userName || 'terminal@suwappu.bot',
            displayName: 'Suwappu Terminal',
          },
          pubKeyCredParams: [
            { type: 'public-key', alg: -7 },
            { type: 'public-key', alg: -257 },
          ],
          authenticatorSelection: {
            residentKey: 'preferred',
            userVerification: 'preferred',
          },
          attestation: 'none',
        },
      })

      if (!credential || credential.type !== 'public-key') {
        throw new Error('Passkey creation was cancelled')
      }

      const publicKeyCredential = credential as PublicKeyCredential
      const response = publicKeyCredential.response as AuthenticatorAttestationResponse
      const transports = typeof response.getTransports === 'function' ? response.getTransports() : []
      const result = await api.passkeyRegisterComplete({
        credentialId: toBase64Url(publicKeyCredential.rawId),
        attestationObject: toBase64Url(response.attestationObject),
        clientDataJSON: toBase64Url(response.clientDataJSON),
        transports,
      })

      setAuthToken(result.token, result.expiresAt)
      setUserId(result.userId)
      setWalletAddress(result.walletAddress)
      setIsAuthenticated(true)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Sign-in failed'
      setError(message)
    } finally {
      setIsLoading(false)
    }
  }, [])

  const signOut = useCallback(() => {
    clearAuthToken()
    setIsAuthenticated(false)
    setUserId(null)
    setWalletAddress(null)
  }, [])

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
        isPasskeySupported,
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
