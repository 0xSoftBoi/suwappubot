/**
 * Authentication context for Suwappu iOS app.
 *
 * Manages passkey and OAuth auth flows, JWT token persistence,
 * and user state. Adapted from webapp/src/contexts/AuthContext.tsx
 * with Telegram-specific logic removed.
 */
import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react'
import * as WebBrowser from 'expo-web-browser'
import { useRouter, useSegments } from 'expo-router'
import { createPasskey, getPasskeyCredential } from '../lib/passkey'
import {
  saveAuthToken,
  loadAuthToken,
  clearAuthToken,
  getAuthToken,
  getWalletAddress,
  isTokenExpiringSoon,
} from '../lib/auth'
import { api } from '../lib/api'
import { authEvents } from '../lib/authEvents'
import {
  registerForPushNotifications,
  setupNotificationCategories,
  unregisterPushNotifications,
} from '../lib/notifications'

export interface AuthUser {
  id: number
  address?: string
  username?: string
  firstName?: string
  lastName?: string
}

interface AuthContextType {
  isAuthenticated: boolean
  isLoading: boolean
  user: AuthUser | null
  walletAddress: string | null
  registerWithPasskey: (displayName?: string) => Promise<boolean>
  loginWithPasskey: () => Promise<boolean>
  loginWithOAuth: (provider: 'google' | 'twitter') => Promise<boolean>
  logout: () => Promise<void>
  refreshUser: () => Promise<void>
}

const AuthContext = createContext<AuthContextType>({
  isAuthenticated: false,
  isLoading: true,
  user: null,
  walletAddress: null,
  registerWithPasskey: async () => false,
  loginWithPasskey: async () => false,
  loginWithOAuth: async () => false,
  logout: async () => {},
  refreshUser: async () => {},
})

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [isLoading, setIsLoading] = useState(true)
  const [user, setUser] = useState<AuthUser | null>(null)
  const [walletAddress, setWalletAddress] = useState<string | null>(null)
  const routerRef = useRef<ReturnType<typeof useRouter> | null>(null)

  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    routerRef.current = useRouter()
  } catch {
    // router not ready during initial render
  }

  const isAuthenticated = !!user

  // Listen for 401 unauthorized events from api.ts
  useEffect(() => {
    const handleUnauthorized = () => {
      setUser(null)
      setWalletAddress(null)
      try {
        routerRef.current?.replace('/(auth)' as any)
      } catch {
        // router may not be ready
      }
    }
    authEvents.on('unauthorized', handleUnauthorized)
    return () => authEvents.off('unauthorized', handleUnauthorized)
  }, [])

  // Load stored auth on mount
  useEffect(() => {
    async function init() {
      try {
        const token = await loadAuthToken()
        if (token) {
          // Verify token is still valid
          const me = await api.getMe()
          if (me.authenticated && me.userId) {
            setUser({ id: me.userId, address: me.address })
            setWalletAddress(me.address || (await getWalletAddress()))

            // Set up push notifications
            await setupNotificationCategories()
            await registerForPushNotifications()
          } else {
            await clearAuthToken()
          }
        }
      } catch {
        await clearAuthToken()
      } finally {
        setIsLoading(false)
      }
    }
    init()
  }, [])

  const registerWithPasskey = useCallback(async (displayName?: string): Promise<boolean> => {
    try {
      // Step 1: Get registration challenge from backend
      const initData = await api.passkeyRegisterInit(displayName)

      // Step 2: Create passkey credential using device biometrics
      const credential = await createPasskey({
        challenge: initData.challenge,
        rp: { id: initData.rpId, name: initData.rpName },
        user: {
          id: initData.userId,
          name: initData.userName,
          displayName: displayName || initData.userName,
        },
        pubKeyCredParams: [
          { alg: -7, type: 'public-key' },   // ES256
          { alg: -257, type: 'public-key' },  // RS256
        ],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          residentKey: 'required',
          userVerification: 'required',
        },
        attestation: initData.attestation,
      })

      // Step 3: Complete registration with backend
      const result = await api.passkeyRegisterComplete(credential)

      if (result.success) {
        await saveAuthToken(result.token, result.expiresAt, 'passkey', result.walletAddress)
        setUser({ id: result.userId, address: result.walletAddress })
        setWalletAddress(result.walletAddress)

        // Register for push notifications after successful auth
        await setupNotificationCategories()
        await registerForPushNotifications()
        return true
      }

      return false
    } catch (error) {
      console.error('Passkey registration failed:', error)
      return false
    }
  }, [])

  const loginWithPasskey = useCallback(async (): Promise<boolean> => {
    try {
      // Step 1: Get auth challenge
      const initData = await api.passkeyAuthenticateInit()

      // Step 2: Authenticate with existing passkey
      const credential = await getPasskeyCredential({
        challenge: initData.challenge,
        rpId: initData.rpId,
        allowCredentials: initData.allowCredentials,
        userVerification: 'required',
      })

      // Step 3: Complete authentication
      const result = await api.passkeyAuthenticateComplete(credential)

      if (result.success) {
        await saveAuthToken(result.token, result.expiresAt, 'passkey', result.walletAddress)
        setUser({ id: result.userId, address: result.walletAddress })
        setWalletAddress(result.walletAddress)

        await setupNotificationCategories()
        await registerForPushNotifications()
        return true
      }

      return false
    } catch (error) {
      console.error('Passkey login failed:', error)
      return false
    }
  }, [])

  const loginWithOAuth = useCallback(async (provider: 'google' | 'twitter'): Promise<boolean> => {
    try {
      const apiBase = process.env.EXPO_PUBLIC_API_URL || 'https://api.suwappu.xyz'
      const redirectUri = 'suwappu://oauth/callback'
      const authUrl = `${apiBase}/auth/oauth/${provider}/authorize?redirect_uri=${encodeURIComponent(redirectUri)}`

      const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUri)

      if (result.type === 'success' && result.url) {
        // Extract token from callback URL
        const url = new URL(result.url)
        const token = url.searchParams.get('token')
        const expiresAt = url.searchParams.get('expires_at')
        const userId = url.searchParams.get('user_id')
        const address = url.searchParams.get('address')

        if (token && expiresAt && userId) {
          await saveAuthToken(token, expiresAt, 'oauth', address || undefined)
          setUser({ id: parseInt(userId, 10), address: address || undefined })
          setWalletAddress(address)

          await setupNotificationCategories()
          await registerForPushNotifications()
          return true
        }
      }

      return false
    } catch (error) {
      console.error('OAuth login failed:', error)
      return false
    }
  }, [])

  const logout = useCallback(async (): Promise<void> => {
    try {
      await unregisterPushNotifications()
      await api.logout()
    } catch {
      // ignore logout API errors
    }
    await clearAuthToken()
    setUser(null)
    setWalletAddress(null)
  }, [])

  const refreshUser = useCallback(async (): Promise<void> => {
    try {
      const me = await api.getMe()
      if (me.authenticated && me.userId) {
        setUser({ id: me.userId, address: me.address })
        setWalletAddress(me.address || null)
      }
    } catch {
      // ignore
    }
  }, [])

  return (
    <AuthContext.Provider
      value={{
        isAuthenticated,
        isLoading,
        user,
        walletAddress,
        registerWithPasskey,
        loginWithPasskey,
        loginWithOAuth,
        logout,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
