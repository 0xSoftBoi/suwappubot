/**
 * TanStack Query hooks for authentication
 *
 * Provides React Query-based auth state management with automatic
 * caching, refetching, and integration with TanStack Router.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import { getTelegramUser, getInitData } from '../lib/telegram'
import {
  getAuthToken,
  setAuthToken,
  clearAuthToken,
  setAuthMethod,
  getAuthMethod,
} from '../lib/auth'
import {
  registerPasskey,
  authenticateWithPasskey,
  getTurnkeyWallets,
  createTurnkeyWallet,
  isPasskeySupported,
  isPlatformAuthenticatorAvailable,
} from '../lib/turnkey-passkey'
import type { TelegramUser, AuthMethod } from '../types/auth'

// Query keys for cache management
export const authKeys = {
  all: ['auth'] as const,
  session: () => [...authKeys.all, 'session'] as const,
  wallets: () => [...authKeys.all, 'wallets'] as const,
  linkedWallets: () => [...authKeys.all, 'linkedWallets'] as const,
  passkeySupport: () => [...authKeys.all, 'passkeySupport'] as const,
}

// Auth session data
interface AuthSession {
  isAuthenticated: boolean
  authMethod: AuthMethod
  telegramUser: TelegramUser | null
  hasToken: boolean
}

/**
 * Hook to check and maintain authentication session
 * Uses TanStack Query for caching and automatic refetching
 */
export function useAuthSession() {
  return useQuery({
    queryKey: authKeys.session(),
    queryFn: async (): Promise<AuthSession> => {
      // Check Telegram auth first (primary for Mini App)
      const telegramUser = getTelegramUser()
      const initData = getInitData()

      if (telegramUser && initData) {
        // Validate Telegram auth with backend
        try {
          const validation = await api.validateAuth()
          if (validation.valid) {
            return {
              isAuthenticated: true,
              authMethod: 'telegram',
              telegramUser,
              hasToken: false,
            }
          }
        } catch {
          // Fall through to check stored session
        }
      }

      // Check for stored JWT session (passkey or wallet auth)
      const token = getAuthToken()
      const storedMethod = getAuthMethod()

      if (token && storedMethod) {
        return {
          isAuthenticated: true,
          authMethod: storedMethod,
          telegramUser,
          hasToken: true,
        }
      }

      return {
        isAuthenticated: false,
        authMethod: null,
        telegramUser,
        hasToken: false,
      }
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 30 * 60 * 1000, // 30 minutes
    refetchOnWindowFocus: true,
    retry: 1,
  })
}

/**
 * Hook to check passkey support
 */
export function usePasskeySupport() {
  return useQuery({
    queryKey: authKeys.passkeySupport(),
    queryFn: async () => {
      const supported = isPasskeySupported()
      const platformAvailable = supported
        ? await isPlatformAuthenticatorAvailable()
        : false

      return {
        isSupported: supported,
        isPlatformAvailable: platformAvailable,
      }
    },
    staleTime: Infinity, // Device support doesn't change
    gcTime: Infinity,
  })
}

/**
 * Hook to get user's linked wallets (external wallets)
 */
export function useAuthLinkedWallets() {
  const { data: session } = useAuthSession()

  return useQuery({
    queryKey: authKeys.linkedWallets(),
    queryFn: () => api.getLinkedWallets(),
    enabled: session?.isAuthenticated === true,
    staleTime: 60 * 1000, // 1 minute
  })
}

/**
 * Hook to get user's Turnkey wallets (passkey-created)
 */
export function useAuthTurnkeyWallets() {
  const { data: session } = useAuthSession()

  return useQuery({
    queryKey: authKeys.wallets(),
    queryFn: () => getTurnkeyWallets(),
    enabled: session?.isAuthenticated === true,
    staleTime: 60 * 1000,
  })
}

/**
 * Hook for passkey registration mutation
 */
export function usePasskeyRegister() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (displayName?: string) => {
      const result = await registerPasskey(displayName)

      if (!result.success) {
        throw new Error(result.error || 'Failed to create passkey')
      }

      return result
    },
    onSuccess: () => {
      // Invalidate wallet queries to refetch
      queryClient.invalidateQueries({ queryKey: authKeys.wallets() })
      queryClient.invalidateQueries({ queryKey: authKeys.linkedWallets() })
    },
  })
}

/**
 * Hook for passkey authentication mutation
 */
export function usePasskeyAuthenticate() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async () => {
      const result = await authenticateWithPasskey()

      if (!result.success) {
        throw new Error(result.error || 'Authentication failed')
      }

      // Store the JWT token
      setAuthToken(result.token, result.expiresAt)
      setAuthMethod('passkey')

      return result
    },
    onSuccess: () => {
      // Invalidate session to trigger re-auth check
      queryClient.invalidateQueries({ queryKey: authKeys.session() })
      queryClient.invalidateQueries({ queryKey: authKeys.wallets() })
    },
  })
}

/**
 * Hook for creating new Turnkey wallets
 */
export function useCreateTurnkeyWallet() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      chainType,
      name,
    }: {
      chainType: 'evm' | 'solana'
      name?: string
    }) => {
      const result = await createTurnkeyWallet(chainType, name)

      if (!result.success) {
        throw new Error(result.error || 'Failed to create wallet')
      }

      return result
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: authKeys.wallets() })
    },
  })
}

/**
 * Hook for logout
 */
export function useLogout() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async () => {
      clearAuthToken()
    },
    onSuccess: () => {
      // Clear all auth-related cache
      queryClient.invalidateQueries({ queryKey: authKeys.all })
      queryClient.setQueryData(authKeys.session(), {
        isAuthenticated: false,
        authMethod: null,
        telegramUser: getTelegramUser(),
        hasToken: false,
      })
    },
  })
}

/**
 * Combined auth state hook for convenience
 * Provides all auth-related data and actions in one hook
 */
export function useAuthState() {
  const session = useAuthSession()
  const passkeySupport = usePasskeySupport()
  const linkedWallets = useAuthLinkedWallets()
  const turnkeyWallets = useAuthTurnkeyWallets()
  const registerMutation = usePasskeyRegister()
  const authenticateMutation = usePasskeyAuthenticate()
  const createWalletMutation = useCreateTurnkeyWallet()
  const logoutMutation = useLogout()

  return {
    // Session state
    isAuthenticated: session.data?.isAuthenticated ?? false,
    isLoading: session.isLoading,
    authMethod: session.data?.authMethod ?? null,
    telegramUser: session.data?.telegramUser ?? null,

    // Passkey support
    isPasskeySupported: passkeySupport.data?.isSupported ?? false,
    isPlatformAuthAvailable: passkeySupport.data?.isPlatformAvailable ?? false,

    // Wallets
    linkedWallets: linkedWallets.data ?? [],
    turnkeyWallets: turnkeyWallets.data ?? [],
    isWalletsLoading: linkedWallets.isLoading || turnkeyWallets.isLoading,

    // Actions
    registerPasskey: registerMutation.mutateAsync,
    authenticatePasskey: authenticateMutation.mutateAsync,
    createWallet: createWalletMutation.mutateAsync,
    logout: logoutMutation.mutate,

    // Mutation states
    isRegistering: registerMutation.isPending,
    isAuthenticating: authenticateMutation.isPending,
    isCreatingWallet: createWalletMutation.isPending,

    // Errors
    error:
      session.error ||
      registerMutation.error ||
      authenticateMutation.error ||
      createWalletMutation.error,

    // Refetch functions
    refetchSession: session.refetch,
    refetchWallets: () => {
      linkedWallets.refetch()
      turnkeyWallets.refetch()
    },
  }
}

// Export types
export type { AuthSession }
